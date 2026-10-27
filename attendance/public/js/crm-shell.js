const frame=document.querySelector('#crm-frame');
document.querySelector('#reload-crm').addEventListener('click',()=>{frame.src=frame.getAttribute('src');});
function connection(){document.querySelector('#crm-offline').hidden=navigator.onLine;}
addEventListener('online',connection);addEventListener('offline',connection);connection();
