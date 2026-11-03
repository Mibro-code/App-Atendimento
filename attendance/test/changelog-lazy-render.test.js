const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('changelog stays unrendered at startup and renders fully when opened',()=>{
  const handlers=new Map();const elements=new Map();
  for(const key of ['#changelog-list','#changelog-current-version','#changelog-current-date','#changelog-unread-dot','#changelog-button','#close-changelog','#changelog-dialog']) elements.set(key,{innerHTML:'',textContent:'',hidden:false,open:false,addEventListener:(event,fn)=>handlers.set(key+event,fn),showModal(){this.open=true;},close(){this.open=false;}});
  elements.set('#app-version-label',{textContent:''});
  let ready;let stored=null;const window={};
  vm.runInNewContext(fs.readFileSync('public/js/changelog.js','utf8'),{window,document:{querySelector:s=>elements.get(s)||null,addEventListener:(_event,fn)=>{ready=fn;}},localStorage:{getItem:()=>stored,setItem:(_key,value)=>{stored=value;}}});
  ready();assert.equal(elements.get('#changelog-list').innerHTML,'');
  handlers.get('#changelog-buttonclick')();
  assert(elements.get('#changelog-list').innerHTML.includes('changelog-release'));
  assert(elements.get('#changelog-dialog').open);
  assert.equal(elements.get('#changelog-unread-dot').hidden,true);
  assert(window.MibroChangelog.releases.length>1);
});
