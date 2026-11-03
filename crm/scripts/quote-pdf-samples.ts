import {mkdir,writeFile} from 'node:fs/promises';
import {sampleQuote} from '../src/lib/quotes/quote-pdf.fixture';
import {quotePdfData} from '../src/lib/quotes/quote-pdf-data';
import {renderQuotePdf} from '../src/lib/quotes/quote-pdf';

async function main(){
 const output='C:/App Whats/proposal-pdf-20261029/output/pdf';await mkdir(output,{recursive:true});
 const samples=[
  ['mibro-curta',sampleQuote()],
  ['sincrofit-longa',sampleQuote({brand:'SINCROFIT',items:Array.from({length:85},(_,i)=>({sku:`DEMO-${i+1}`,productName:`Produto ${i+1} — descrição de demonstração com acentuação`,colorName:'Preto',quantity:1,unitPriceCents:1000,lineSubtotalCents:1000})),totalValueCents:85000,subtotalCents:85000,discountCents:0})],
  ['historica',sampleQuote({items:[],productsSummary:{products:[{name:'Produto de proposta histórica',quantity:2}]},subtotalCents:null,discountCents:null})],
 ] as const;
 for(const [name,quote] of samples){const bytes=await renderQuotePdf(quotePdfData(quote));await writeFile(`${output}/${name}.pdf`,bytes);console.log(`${name}: ${bytes.length} bytes`);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
