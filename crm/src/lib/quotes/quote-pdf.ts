import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument,rgb,type PDFPage,type PDFFont} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {QuotePdfDataError,type QuotePdfData} from './quote-pdf-data';

// Server only, imported on demand by the authenticated download route. No files,
// provider calls, repricing, status changes or public share tokens are produced.
let fontBytes:Promise<Buffer[]>|undefined;
function fonts(){
  if(!fontBytes)fontBytes=Promise.all(['NotoSans-Regular.ttf','NotoSans-Bold.ttf'].map(f=>readFile(path.join(process.cwd(),'public/fonts',f)))).catch(e=>{fontBytes=undefined;throw e;});
  return fontBytes;
}
const ink=rgb(.10,.13,.18),muted=rgb(.40,.44,.49),line=rgb(.87,.89,.91),paper=rgb(.96,.97,.98);
const money=(v:number|null)=>v===null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
export async function renderQuotePdf(data:QuotePdfData):Promise<Uint8Array>{
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const [regularBytes,boldBytes]=await fonts();
  const [regular,bold]=await Promise.all([doc.embedFont(regularBytes,{subset:true}),doc.embedFont(boldBytes,{subset:true})]);
  const accent=data.brand==='MIBRO'?rgb(.91,.30,.12):rgb(.05,.49,.53);
  const brand=data.brand==='MIBRO'?'Mibro Brasil':'Sincrofit';
  doc.setTitle(`Proposta ${data.reference} · ${brand}`);doc.setAuthor(brand);doc.setLanguage('pt-BR');
  const width=595.28,height=841.89,left=42,right=width-42;let page!:PDFPage,y=0;
  function draw(t:string,x:number,at:number,size=10,font:PDFFont=regular,color=ink){page.drawText(t,{x,y:at,size,font,color});}
  function newPage(){
    if(doc.getPageCount()>=100)throw new QuotePdfDataError('A proposta excede o limite de páginas do PDF.');
    page=doc.addPage([width,height]);
    page.drawRectangle({x:left,y:height-45,width:32,height:3,color:accent});
    draw(brand.toUpperCase(),left,height-64,11,bold,accent);
    draw(`PROPOSTA #${data.reference}`,right-bold.widthOfTextAtSize(`PROPOSTA #${data.reference}`,9),height-64,9,bold,muted);
    if(data.watermark)draw(data.watermark,left,height-80,7,bold,accent);
    y=height-98;
  }
  function ensure(space:number,table=false){if(y-space<62){newPage();if(table)tableHead();}}
  function wrap(value:string,maxWidth:number,size=10,font:PDFFont=regular){
    const output:string[]=[];
    for(const paragraph of value.split(/\r?\n/)){
      let current='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        if(font.widthOfTextAtSize(word,size)>maxWidth){
          if(current){output.push(current);current='';}
          for(const char of word){if(font.widthOfTextAtSize(current+char,size)>maxWidth){output.push(current);current='';}current+=char;}
        }else if(current&&font.widthOfTextAtSize(current+' '+word,size)>maxWidth){output.push(current);current=word;}else current+=(current?' ':'')+word;
      }
      output.push(current);
    }
    return output;
  }
  function block(value:string,size=10,font:PDFFont=regular,color=ink){for(const t of wrap(value,right-left,size,font)){ensure(size+6);draw(t,left,y,size,font,color);y-=size+6;}}
  function label(value:string){ensure(28);draw(value,left,y,8,bold,muted);y-=19;}
  function tableHead(){
    page.drawRectangle({x:left,y:y-8,width:right-left,height:27,color:paper});
    draw('PRODUTO / SKU',left+9,y,8,bold,muted);draw('QTD.',337,y,8,bold,muted);draw('UNITÁRIO',395,y,8,bold,muted);draw('SUBTOTAL',493,y,8,bold,muted);y-=31;
  }
  function alignRight(value:string,x:number,at:number,size=9,font:PDFFont=regular,color=ink){draw(value,x-font.widthOfTextAtSize(value,size),at,size,font,color);}
  newPage();
  block('Proposta comercial',25,bold);y-=3;
  block(`${data.simulation?'Simulação comercial':'Proposta registrada'} · Criada em ${new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo'}).format(data.createdAt)}`,9,regular,muted);y-=16;
  label('CLIENTE');for(let i=0;i<data.customerLines.length;i++)block(data.customerLines[i],i?9:12,i?regular:bold,i?muted:ink);y-=14;
  ensure(75);tableHead();
  for(const item of data.items){
    const name=wrap(item.description,265,10),detail=item.detail?wrap(item.detail,265,8):[];
    const rowHeight=Math.max(40,name.length*14+detail.length*11+15);
    if(rowHeight>height-193)throw new QuotePdfDataError('Um item possui uma descrição extensa demais para o PDF.');
    ensure(rowHeight,true);const top=y;
    for(const value of name){draw(value,left+9,y,10);y-=14;}
    for(const value of detail){draw(value,left+9,y,8,regular,muted);y-=11;}
    alignRight(String(item.quantity),365,top);
    alignRight(money(item.unitPrice),465,top);alignRight(money(item.subtotal),right-8,top,9,bold);
    y=top-rowHeight;page.drawLine({start:{x:left,y:y+14},end:{x:right,y:y+14},thickness:.6,color:line});
  }
  y-=8;ensure(105);
  for(const [title,value]of [['Subtotal',data.subtotal],['Desconto',data.discount],['Frete',data.freight??null]] as const){if(value===null)continue;draw(title,350,y,9,regular,muted);alignRight(money(value),right-8,y);y-=19;}
  y-=12;
  page.drawRectangle({x:335,y:y-15,width:right-335,height:39,color:paper});draw('TOTAL',348,y,10,bold);alignRight(money(data.total),right-9,y,14,bold,accent);y-=46;
  if(data.notes){label('OBSERVAÇÕES');block(data.notes,9);y-=14;}
  if(data.sellerLines.length){label('ATENDIMENTO COMERCIAL');for(const value of data.sellerLines)block(value,9);}
  if(data.simulation){y-=10;block('Simulação comercial. Não representa confirmação de pedido.',8,regular,muted);}
  const pages=doc.getPages();for(let i=0;i<pages.length;i++){
    page=pages[i];page.drawLine({start:{x:left,y:43},end:{x:right,y:43},thickness:.6,color:line});
    draw('Valores e dados conforme a proposta registrada.',left,29,7,regular,muted);
    alignRight(`${i+1} / ${pages.length}`,right,29,7,regular,muted);
  }
  return doc.save();
}
