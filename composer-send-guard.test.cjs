const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {create}=require('./attendance/public/js/composer-send-guard');
const source=fs.readFileSync(__dirname+'/attendance/public/js/app.js','utf8');
function setup(){
 let id=0;const guard=create({newId:()=>`operation-${String(++id).padStart(20,'0')}`});
 const listeners={},nodes=new Map();
 function $(key){if(!nodes.has(key))nodes.set(key,{value:'',disabled:false,focus(){},addEventListener(type,handler){listeners[key+':'+type]=handler;}});return nodes.get(key);}
 $('#message-input').value='ok';
 const calls=[],context={composerSendGuard:guard,$,state:{selectedId:'a',pendingBotSuggestion:null},selectedAttachment:null,pendingAudio:null,isAudioRecording:()=>false,stopAudioRecording(){},toast(){},window:{},FormData,resetComposerHeight(){},hideSlashSuggestions(){},openConversation:async()=>{},syncCustomerServiceWindow(){ $('#send-button').disabled=guard.isSending(); },api:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});}};
 const start=source.indexOf('$("#composer").addEventListener("submit"');
 const end=source.indexOf('$("#open-templates").addEventListener',start);
 vm.runInNewContext(source.slice(start,end),context);
 return{guard,$,calls,context,submit:()=>listeners['#composer:submit']({preventDefault(){}})};
}
test('submit storm and realtime refresh cannot release the active lock',async()=>{
 const h=setup();let finish;h.context.api=async(...args)=>{h.calls.push(args);await new Promise(r=>finish=r);};
 const first=h.submit();h.context.syncCustomerServiceWindow();assert.equal(h.$('#send-button').disabled,true);
 await Promise.all(Array.from({length:5},()=>h.submit()));assert.equal(h.calls.length,1);
 finish();await first;assert.equal(h.guard.isSending(),false);assert.equal(h.$('#message-input').value,'');
});
test('connection retry reuses the operation ID and successful intentional resend gets a new one',async()=>{
 const h=setup();let fail=true;h.context.api=async(url,options)=>{h.calls.push(JSON.parse(options.body));if(fail)throw Error('network');};
 await h.submit();assert.equal(h.$('#message-input').value,'ok');fail=false;await h.submit();
 assert.equal(h.calls[0].clientRequestId,h.calls[1].clientRequestId);
 h.$('#message-input').value='ok';await h.submit();assert.notEqual(h.calls[1].clientRequestId,h.calls[2].clientRequestId);
});
test('switching conversations while sending preserves the new conversation draft',async()=>{
 const h=setup();let finish;h.context.api=async()=>new Promise(r=>finish=r);
 const first=h.submit();h.context.state.selectedId='b';h.$('#message-input').value='new draft';finish();await first;
 assert.equal(h.$('#message-input').value,'new draft');assert.equal(h.guard.isSending(),false);
});
test('typing next text during send preserves it',async()=>{
 const h=setup();let finish;h.context.api=async()=>new Promise(r=>finish=r);
 const first=h.submit();h.$('#message-input').value='next message';finish();await first;assert.equal(h.$('#message-input').value,'next message');
});
test('warning cancellation and setup failures always release the lock without sending',async()=>{
 const h=setup();h.context.window.ContactWarning={confirm:async()=>false};await h.submit();assert.equal(h.calls.length,0);assert.equal(h.guard.isSending(),false);
 h.context.window.ContactWarning=null;h.context.window.CrmProposalDraft={payload(){throw Error('draft');}};await h.submit();assert.equal(h.guard.isSending(),false);
});
test('keydown ignores held Enter and IME composition but allows Shift+Enter',()=>{
 const h=setup();let submissions=0;
 h.$('#composer').requestSubmit=()=>submissions++;
 h.context.quickReplySlashActive=null;
 const start=source.indexOf('$("#message-input").addEventListener("keydown"');
 const end=source.indexOf('// Navegação móvel',start);
 let handler;h.$('#message-input').addEventListener=(_,fn)=>handler=fn;
 vm.runInNewContext(source.slice(start,end),h.context);
 const key=(extra={})=>handler({key:'Enter',preventDefault(){},...extra});
 key({repeat:true});key({isComposing:true});key({shiftKey:true});assert.equal(submissions,0);
 key();assert.equal(submissions,1);h.guard.acquire();key();assert.equal(submissions,1);
});
