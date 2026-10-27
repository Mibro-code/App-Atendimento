// Conversão somente de anexos escolhidos pela equipe, nunca do webhook.
// Um processo por instância, sem fila em RAM, sem shell ou URLs de entrada.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeOutgoingAudio } = require('./audio-normalization-service');
const MB = 1024 * 1024;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const ascii = (buffer, offset, size) => buffer.subarray(offset, offset + size).toString('ascii');

function conversionFormat(buffer, kind) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('O arquivo está vazio.');
  if (kind === 'image') {
    if (ascii(buffer, 0, 2) === 'BM') return 'bmp_pipe';
    if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP') {
      if (ascii(buffer, 12, 4) === 'VP8X' && (buffer[20] & 2)) return 'webp-animation';
      return 'webp_pipe';
    }
    return null;
  }
  if (kind === 'audio') {
    if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WAVE') return 'wav';
    if (ascii(buffer, 0, 4) === 'fLaC') return 'flac';
    return null;
  }
  if (kind === 'video') {
    if (['GIF87a', 'GIF89a'].includes(ascii(buffer, 0, 6))) return 'gif';
    if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'AVI ') return 'avi';
    // Apenas QuickTime explícito. MP4/3GP existentes seguem o caminho atual.
    if (ascii(buffer, 4, 4) === 'ftyp' && ascii(buffer, 8, 4) === 'qt  ') return 'mov';
    return null;
  }
  if(kind==='document'){
    if((buffer[0]===73&&buffer[1]===73&&buffer[2]===42&&buffer[3]===0)||(buffer[0]===77&&buffer[1]===77&&buffer[2]===0&&buffer[3]===42))return 'tiff';
    if(ascii(buffer,4,4)==='ftyp'&&['heic','heix','hevc','hevx','mif1','msf1'].includes(ascii(buffer,8,4)))return 'heif';
    return null;
  }
  throw fail('Tipo de mídia inválido.');
}

function run(binary, args, maxBytes, spawnProcess = spawn, timeoutMs = 45000, temporaryDirectory=os.tmpdir()) {
  return new Promise((resolve, reject) => {
    let child;
    const env={PATH:process.env.PATH,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TMPDIR:temporaryDirectory,TMP:temporaryDirectory,TEMP:temporaryDirectory,MAGICK_TEMPORARY_PATH:temporaryDirectory,OMP_NUM_THREADS:'1',MAGICK_THREAD_LIMIT:'1'};
    if(process.platform==='win32'){env.SystemRoot=process.env.SystemRoot;env.WINDIR=process.env.WINDIR;}
    const command=process.platform==='linux'?'prlimit':binary;
    const parameters=process.platform==='linux'?['--as=805306368','--data=268435456','--cpu=40','--core=0','--nofile=128','--fsize=16777216','--',binary,...args]:args;
    try { child = spawnProcess(command, parameters, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return reject(fail('Conversor de mídia indisponível. Tente novamente mais tarde.', 503)); }
    // Favorece o processo do atendimento se houver disputa pela CPU.
    if (process.platform === 'linux' && child.pid) {
      try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* limites do host continuam válidos */ }
    }
    const chunks = []; let size = 0, problem = null;
    const timer = setTimeout(() => { problem = fail('A conversão excedeu o tempo limite. Use um arquivo menor.'); child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { problem = fail('O arquivo convertido ultrapassou o limite permitido.', 413); child.kill('SIGKILL'); }
      else if (!problem) chunks.push(chunk);
    });
    child.once('error', () => { clearTimeout(timer); reject(fail('Conversor de mídia indisponível. Tente novamente mais tarde.', 503)); });
    child.once('close', code => {
      clearTimeout(timer);
      if (problem || code !== 0) return reject(problem || fail('Não foi possível converter este arquivo. Reenvie em um formato compatível.'));
      resolve(Buffer.concat(chunks));
    });
  });
}

function createConverter({ execute = run } = {}) {
  let active = false;
  return async function convert({ buffer, kind, mimeType, fileName, declaredDurationMs }) {
    let limit = kind === 'image' ? 5 * MB : 16 * MB;
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > limit) throw fail('Arquivo vazio ou acima do limite permitido.', 413);
    let format = conversionFormat(buffer, kind);
    if (!format) return kind === 'audio' ? normalizeOutgoingAudio({ buffer, fileName, declaredDurationMs }) : { buffer, mimeType, fileName };
    if (active) throw fail('O conversor está ocupado. Aguarde um momento e tente enviar novamente.', 429);
    active = true; let directory;
    try {
      const deadline=Date.now()+60000;
      const invoke=(binary,args,max)=>{if(Date.now()>=deadline)throw fail('A conversão excedeu o tempo limite.');return execute(binary,args,max,undefined,Math.min(45000,deadline-Date.now()),directory);};
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'central-media-'));
      const input = path.join(directory, 'input');
      await fs.writeFile(input, buffer, { mode: 0o600 });
      if(kind==='document'){
        const info=(await invoke(format==='heif'?'heif-info':'tiffinfo',[input],65536)).toString();
        const expression=format==='heif'?/^\s*image:\s*(\d+)x(\d+)/gm:/Image Width:\s*(\d+)\s*Image Length:\s*(\d+)/g;
        const dimensions=[...info.matchAll(expression)];
        if(!dimensions.length||dimensions.length>20||dimensions.reduce((sum,row)=>sum+Number(row[1])*Number(row[2]),0)>16000000)throw fail('O documento excede o limite de páginas ou resolução para conversão.');
        let result;
        if(format==='tiff')result=await invoke('tiff2pdf',['-z',input],limit);
        else{
          await invoke('heif-convert',[input,path.join(directory,'page.jpg')],65536);
          const files=(await fs.readdir(directory)).filter(file=>/^page(?:-\d+)?\.jpg$/.test(file)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
          if(files.length!==dimensions.length)throw fail('Não foi possível preservar todas as imagens do arquivo HEIF.');
          const pages=[];let bytes=0;for(const file of files){const data=await fs.readFile(path.join(directory,file));bytes+=data.length;if(bytes>limit)throw fail('Documento convertido acima do limite.',413);pages.push(data);}
          result=require('./jpeg-pages-pdf').jpegPagesPdf(pages);
        }
        if(result.length>limit||result.subarray(0,5).toString()!=='%PDF-')throw fail('Não foi possível gerar um PDF compatível.');
        const base=path.basename(fileName||'documento').replace(/\.[^.]*$/,'').replace(/[^\p{L}\p{N} _-]/gu,'_').slice(0,100)||'documento';
        return {buffer:result,mimeType:'application/pdf',fileName:base+'.pdf'};
      }
      let animationDuration=null;
      if(format==='webp-animation'){
        if(buffer.length<30)throw fail('WebP animado inválido.');
        let frames=0;animationDuration=0;
        for(let offset=12;offset+8<=buffer.length;){const size=buffer.readUInt32LE(offset+4);if(offset+8+size>buffer.length)throw fail('WebP animado incompleto.');if(ascii(buffer,offset,4)==='ANMF'){if(size<16)throw fail('WebP animado inválido.');const milliseconds=buffer.readUIntLE(offset+20,3);if(!milliseconds)throw fail('Duração de quadro WebP inválida.');animationDuration+=milliseconds/1000;frames++;}offset+=8+size+(size%2);}
        const pixels=(buffer.readUIntLE(24,3)+1)*(buffer.readUIntLE(27,3)+1);
        if(frames<1||frames>150||pixels*frames>64000000)throw fail('WebP animado acima do limite de quadros ou resolução.');
        const gif=await invoke('convert',['-limit','thread','1','-limit','memory','64MiB','-limit','map','0','-limit','disk','32MiB','-limit','width','4096','-limit','height','4096','webp:'+input,'-coalesce','gif:-'],16*MB);
        await fs.writeFile(input,gif);format='gif';kind='video';limit=16*MB;
      }
      const common = ['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe', '-f', format];
      const probe = JSON.parse((await invoke('ffprobe', [...common, '-show_entries', 'stream=codec_type,width,height,duration:format=duration', '-of', 'json', input], 65536)).toString('utf8'));
      const streams = Array.isArray(probe.streams) ? probe.streams : [];
      const video = streams.find(stream => stream.codec_type === 'video');
      if ((kind !== 'audio' && !video) || (kind === 'audio' && !streams.some(stream => stream.codec_type === 'audio'))) throw fail('O arquivo não contém a mídia esperada.');
      if (video && (!(video.width > 0 && video.height > 0) || video.width * video.height > 16000000)) throw fail('A imagem ou vídeo excede o limite de resolução para conversão.');
      const duration = animationDuration ?? Number(probe.format?.duration || streams.find(stream => Number(stream.duration) > 0)?.duration);
      if (kind !== 'image' && (!Number.isFinite(duration) || duration <= 0 || duration > (kind === 'audio' ? 600 : 300))) throw fail('Duração inválida ou acima do limite de conversão (áudio: 10 minutos; vídeo: 5 minutos).');
      const resetTiming=format==='gif'?',fps=30,setpts=PTS-STARTPTS':'';
      const output = kind === 'image'
        ? ['-map', '0:v:0', '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe']
        : kind === 'audio'
          ? ['-map', '0:a:0', '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg']
          : ['-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1"+resetTiming+",tpad=stop_mode=clone:stop_duration="+duration, '-c:v', 'libx264', '-r', '30', '-bf', '0', '-t', String(duration), '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4'];
      const outputFile=kind==='video'?path.join(directory,'converted.mp4'):null;
      const streamed=await invoke('ffmpeg', [...common, '-threads', '1', '-filter_threads', '1', '-nostdin', '-i', input, '-map_metadata', '-1', ...output, '-threads', '1', outputFile||'pipe:1'],outputFile?65536:limit);
      if(outputFile&&(await fs.stat(outputFile)).size>limit)throw fail('O arquivo convertido ultrapassou o limite permitido.',413);
      const result=outputFile?await fs.readFile(outputFile):streamed;
      if (!result.length || result.length > limit) throw fail('Arquivo convertido vazio ou acima do limite permitido.', 413);
      const base = path.basename(fileName || 'anexo').replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N} _-]/gu, '_').slice(0, 100) || 'anexo';
      const converted = { buffer: result, mimeType: { image: 'image/png', audio: 'audio/ogg', video: 'video/mp4' }[kind], fileName: base + { image: '.png', audio: '.ogg', video: '.mp4' }[kind] };
      return kind === 'audio' ? normalizeOutgoingAudio({ buffer: result, fileName: converted.fileName, declaredDurationMs: duration * 1000 }) : converted;
    } finally {
      try { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
      finally { active = false; }
    }
  };
}

module.exports = { conversionFormat, createConverter, convertOutgoingMedia: createConverter(), run };
