// JPEG input is produced by the local HEIF decoder, never HTML or commands.
function jpegInfo(buffer){
  if(buffer[0]!==255||buffer[1]!==216)throw Error('JPEG inválido.');
  for(let offset=2;offset+4<buffer.length;){
    if(buffer[offset++]!==255)throw Error('JPEG inválido.');
    while(buffer[offset]===255)offset++;
    const marker=buffer[offset++];if(marker===217||marker===218)break;
    const length=buffer.readUInt16BE(offset);if(length<2||offset+length>buffer.length)break;
    if([192,193,194].includes(marker)&&length>=8){const height=buffer.readUInt16BE(offset+3),width=buffer.readUInt16BE(offset+5),components=buffer[offset+7];if(!width||!height||![1,3].includes(components))throw Error('JPEG inválido.');return {width,height,components};}
    offset+=length;
  }
  throw Error('JPEG sem dimensões válidas.');
}
function jpegPagesPdf(images){
  if(!images.length||images.length>20)throw Error('Quantidade de páginas inválida.');
  const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Count '+images.length+' /Kids ['+images.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>')];
  for(const [i,buffer]of images.entries()){
    const {width,height,components}=jpegInfo(buffer);if(width*height>16000000)throw Error('Imagem acima do limite.');
    const scale=Math.min(595/width,842/height),w=width*scale,h=height*scale,stream=Buffer.from(`q ${w} 0 0 ${h} ${(595-w)/2} ${(842-h)/2} cm /Image Do Q`);
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Image ${4+i*3} 0 R >> >> /Contents ${5+i*3} 0 R >>`));
    objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /${components===1?'DeviceGray':'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${buffer.length} >>\nstream\n`),buffer,Buffer.from('\nendstream')]));
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),stream,Buffer.from('\nendstream')]));
  }
  const chunks=[Buffer.from('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n','binary')],offsets=[0];let length=chunks[0].length;
  for(const [i,object]of objects.entries()){offsets.push(length);const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);chunks.push(chunk);length+=chunk.length;}
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
module.exports={jpegInfo,jpegPagesPdf};
