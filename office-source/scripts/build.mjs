import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
process.chdir(root);
const out=path.join(root,'dist/client');fs.mkdirSync(out,{recursive:true});
const esbuild=require.resolve('esbuild/bin/esbuild');
const bundle=spawnSync(process.execPath,[esbuild,'app/main.tsx','--bundle','--format=esm','--target=es2022','--minify','--legal-comments=external','--outfile=dist/client/app.js','--define:process.env.NODE_ENV="production"'],{stdio:'inherit',windowsHide:true});
if(bundle.error)throw bundle.error;if(bundle.status!==0)process.exit(bundle.status||1);
const styles=await postcss([tailwind({base:root,optimize:true})]).process(fs.readFileSync('app/globals.css','utf8'),{from:'app/globals.css',to:'dist/client/app.css'});
fs.writeFileSync(path.join(out,'app.css'),styles.css);
for(const file of fs.readdirSync('public')){const source=path.join('public',file);if(fs.statSync(source).isFile())fs.copyFileSync(source,path.join(out,file));}
const version=file=>createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex').slice(0,12);
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="description" content="จัดการสินค้า รับเข้า ตรวจนับ และจัดซื้อ ร้านชุติมา"><title>ชุติมา · หลังบ้านสินค้า</title><link rel="icon" href="./logo.jpg"><link rel="stylesheet" href="./app.css?v=${version('app.css')}"></head><body><div id="root"></div><script type="module" src="./app.js?v=${version('app.js')}"></script></body></html>`);
console.log('Built private inventory website:',out);
