const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),{createConverter}=require('./src/services/media-conversion-service');
const {PDFDocument}=require('/test-dependencies/pdf-lib/dist/pdf-lib.min.js');
test('real HEIC and multipage TIFF preserve pages as PDF; animated WebP preserves frames as MP4',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'extra-media-fixture-')),convert=createConverter();
 try{
  for(const color of ['blue','red'])await execute('ffmpeg',['-v','error','-nostdin','-threads','1','-filter_threads','1','-f','lavfi','-i','color=c='+color+':s=32x32','-frames:v','1','-threads','1',path.join(folder,color+'.png')],{timeout:10000});
  const blue=path.join(folder,'blue.png'),red=path.join(folder,'red.png'),tiff=path.join(folder,'pages.tiff'),heic=path.join(folder,'pages.heic'),webp=path.join(folder,'animated.webp');
  await execute('convert',['-limit','thread','1',blue,red,tiff],{timeout:10000});
  await execute('heif-enc',['-q','80','-p','x265:pools=none','-p','x265:frame-threads=1','-o',heic,blue,red],{timeout:10000});
  await execute('convert',['-limit','thread','1','-delay','20',blue,red,'-loop','0',webp],{timeout:10000});
  for(const [file,kind]of [[tiff,'document'],[heic,'document'],[webp,'image']]){
   console.log('Validating synthetic '+path.extname(file));const started=performance.now();
   const result=await convert({buffer:await fs.readFile(file),kind,fileName:path.basename(file)});
   if(kind==='document'){assert.equal(result.mimeType,'application/pdf');const doc=await PDFDocument.load(result.buffer);assert.equal(doc.getPageCount(),2);}
   else{assert.equal(result.mimeType,'video/mp4');const output=path.join(folder,'result.mp4');await fs.writeFile(output,result.buffer);const meta=JSON.parse((await execute('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',output])).stdout);assert.equal(meta.streams[0].codec_name,'h264');assert.ok(Number(meta.streams[0].nb_read_frames)>=2);assert.ok(Number(meta.format.duration)>=.35);const frame=async time=>(await execute('ffmpeg',['-v','error','-threads','1','-filter_threads','1','-ss',String(time),'-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer',timeout:10000})).stdout;const first=await frame(.01),last=await frame(.3);assert.ok(first[2]>first[0]+100,'first blue frame must remain');assert.ok(last[0]>last[2]+100,'last red frame must remain');}
   console.log(JSON.stringify({fixture:path.extname(file),bytes:result.buffer.length,conversionMs:Math.round(performance.now()-started)}));
  }
 }finally{await fs.rm(folder,{recursive:true,force:true});}
});
