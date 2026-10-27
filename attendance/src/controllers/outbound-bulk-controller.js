// Controller do painel "Nova conversa" (envio individual e em massa pelo
// WhatsApp). Toda regra de permissão/validação vive no serviço — aqui só
// traduz HTTP. `channel` (número principal) chega por closure, igual a
// campaign-controller.js.
const bulk = require("../services/outbound-bulk-service");
const authorization = require("../services/authorization-service");
const { parsePastedList } = require("../services/bulk-send-rules");
const { detectCsvDelimiter, parseCsv } = require("../services/campaign-csv-service");
const { CSV_MAX_ROWS } = require("../services/campaign-constants");
const inboxEvents = require("../realtime/inbox-events");
const companyService = require("../services/company-service");
const prisma = require("../database/prisma");
const workspaceCompany = req => companyService.resolveWorkspace(req.user, req.query.company || req.body?.company);
async function validateWorkspaceSender(req, accountId) {
  const company = await workspaceCompany(req);
  const account = !accountId || accountId === "legacy"
    ? await require("../services/whatsapp-account-service").getLegacyAccount()
    : await prisma.channelAccount.findUnique({ where: { id: accountId }, select: { companyId: true, channel: true } });
  if (!account || account.companyId !== company || account.channel !== "META") throw authorization.forbidden("Selecione um número da empresa aberta.");
  return company;
}

function assertCanBulk(user) {
  if (!authorization.canManageCampaigns(user)) throw authorization.forbidden("Você não tem permissão para envio em massa.");
}

function createOutboundBulkController(channel) {
  return {
    async contactWarning(req,res,next){
      try{
        if(['conversationId','campaignId','accountId','company','phone'].some(key=>req.body?.[key]!==undefined&&(typeof req.body[key]!=='string'||req.body[key].length>128)))throw Object.assign(Error('Consulta inválida.'),{statusCode:400});
        let companyId,phones,replyAllowed=false;
        if(req.body?.conversationId){
          const conversation=await authorization.assertCanActOnConversation(req.user,req.body.conversationId);
          const row=await prisma.conversation.findUnique({where:{id:conversation.id},select:{companyId:true,channel:true,contact:{select:{phone:true}}}});
          if(row.channel!=='META')return res.json({warnings:[]});
          companyId=row.companyId;phones=[row.contact.phone];
          replyAllowed=true;
        }else if(req.body?.campaignId){
          const campaign=await prisma.campaign.findUnique({where:{id:req.body.campaignId},select:{companyId:true}});
          if(!campaign)throw Object.assign(Error('Campanha não encontrada.'),{statusCode:404});
          await require('../services/campaign-service').assertCampaignCompanyPermission(req.user,campaign.companyId);
          companyId=campaign.companyId;
          const warnings=[];let cursor;
          do{
            const rows=await prisma.campaignContact.findMany({where:{campaignId:req.body.campaignId,isTest:false,status:{in:['PENDING','QUEUED']}},select:{id:true,phone:true},orderBy:{id:'asc'},take:500,...(cursor?{cursor:{id:cursor},skip:1}:{})});
            if(!rows.length)break;
            warnings.push(...(await require('../services/cross-company-contact-warning').check(req.user,companyId,rows.map(row=>row.phone))).filter(row=>row.contactedElsewhere));
            cursor=rows.length===500?rows[rows.length-1].id:null;
          }while(cursor);
          return res.set('Cache-Control','no-store').json({count:warnings.length,warnings:warnings.slice(0,100)});
        }else{
          companyId=await validateWorkspaceSender(req,req.body?.accountId);
          const accountId=req.body?.accountId;
          const permissionAccountId=accountId&&accountId!=='legacy'?accountId:(await require('../services/whatsapp-account-service').getLegacyAccount())?.id;
          if(!permissionAccountId||!(await authorization.canAccessChannelAccount(req.user,permissionAccountId)))throw authorization.forbidden();
          phones=[req.body?.phone];
        }
        return res.set('Cache-Control','no-store').json({warnings:await require('../services/cross-company-contact-warning').check(req.user,companyId,phones,{replyAllowed})});
      }catch(error){return next(error);}
    },
    async numbers(req, res, next) {
      try { return res.json(await bulk.listSenderNumbers(req.user, channel, { company: await workspaceCompany(req) })); } catch (error) { return next(error); }
    },
    async templates(req, res, next) {
      try { await validateWorkspaceSender(req, req.query.accountId); return res.json(await bulk.listSenderTemplates(req.user, req.query.accountId, channel)); } catch (error) { return next(error); }
    },
    async searchContacts(req, res, next) {
      try { return res.json(await bulk.searchCentralContacts(req.user, { ...req.query, company: await workspaceCompany(req) })); } catch (error) { return next(error); }
    },
    async contactFilters(req, res, next) {
      try { return res.json(await bulk.centralFilterOptions(req.user, { company: await workspaceCompany(req) })); } catch (error) { return next(error); }
    },
    async selectAllContacts(req, res, next) {
      try { return res.json(await bulk.selectAllCentralContacts(req.user, { ...req.body, company: await workspaceCompany(req) })); } catch (error) { return next(error); }
    },
    // Lista colada: só normaliza/classifica — nada é salvo nem enviado.
    async parsePhones(req, res, next) {
      try {
        assertCanBulk(req.user);
        const text = String(req.body?.text || "");
        if (text.length > 1_000_000) throw Object.assign(new Error("Lista muito grande. Use a importação de arquivo."), { statusCode: 400 });
        return res.json(parsePastedList(text));
      } catch (error) { return next(error); }
    },
    // CSV: devolve cabeçalhos + linhas para o mapeamento de colunas na tela.
    // Nunca envia nada; os destinatários só entram após revisão.
    async parseCsvFile(req, res, next) {
      try {
        assertCanBulk(req.user);
        if (!req.file) throw Object.assign(new Error("Envie um arquivo CSV."), { statusCode: 400 });
        const text = req.file.buffer.toString("utf8").replace(/^﻿/, "");
        const rows = parseCsv(text, detectCsvDelimiter(text));
        if (!rows.length) throw Object.assign(new Error("O arquivo está vazio."), { statusCode: 400 });
        const [headers, ...data] = rows;
        if (data.length > CSV_MAX_ROWS) throw Object.assign(new Error(`O arquivo tem mais de ${CSV_MAX_ROWS} linhas.`), { statusCode: 400 });
        return res.json({ fileName: req.file.originalname, headers: headers.map((header) => String(header).trim()), rows: data });
      } catch (error) { return next(error); }
    },
    async preview(req, res, next) {
      try { await validateWorkspaceSender(req, req.body?.accountId); return res.json(await bulk.previewBulkSend(req.user, req.body, channel)); } catch (error) { return next(error); }
    },
    async create(req, res, next) {
      try {
        await validateWorkspaceSender(req, req.body?.accountId);
        const result = await bulk.createBulkSend(req.user, req.body, channel);
        inboxEvents.publish();
        return res.status(result.duplicateRequest ? 200 : 201).json(result);
      } catch (error) { return next(error); }
    },
    async listBatches(req, res, next) {
      try { return res.json(await bulk.listMyBulkSends(req.user)); } catch (error) { return next(error); }
    },
    async batch(req, res, next) {
      try { return res.json(await bulk.getBulkSend(req.user, req.params.id)); } catch (error) { return next(error); }
    },
    async contactHistory(req, res, next) {
      try { return res.json(await bulk.contactTemplateHistory(req.user, req.params.id)); } catch (error) { return next(error); }
    },
  };
}

module.exports = { createOutboundBulkController };
