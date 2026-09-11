'use client';
import {useId,useState} from 'react';
import type {Product} from './office-api';
import {Input} from '@/components/ui/input';
export default function ProductSearch({products,value,onChange,disabled,label}:{products:Product[];value:string;onChange:(id:string)=>void;disabled?:boolean;label:string}){
 const id=useId(),[query,setQuery]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(0);
 const selected=products.find(p=>p.id===value),q=query.trim().toLocaleLowerCase();
 const matches=products.filter(p=>p.enabled!==false&&(!q||[p.name,p.sku,p.barcode,p.packBarcode].some(x=>x?.toLocaleLowerCase().includes(q)))).slice(0,25);
 const choose=(p:Product)=>{onChange(p.id);setQuery('');setOpen(false);};
 return <div className="product-search"><label htmlFor={id}>{label}</label><Input id={id} disabled={disabled} role="combobox" aria-expanded={open} aria-controls={id+'-results'} aria-autocomplete="list" aria-activedescendant={open&&matches[active]?id+'-'+active:undefined} value={open?query:selected?selected.name+' · '+selected.sku:''} placeholder="พิมพ์ชื่อ / รหัส / บาร์โค้ด" onFocus={()=>{setOpen(true);setActive(0);}} onBlur={()=>setOpen(false)} onChange={e=>{setQuery(e.target.value);setOpen(true);setActive(0);}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(n=>Math.min(n+1,matches.length-1));}if(e.key==='ArrowUp'){e.preventDefault();setActive(n=>Math.max(0,n-1));}if(e.key==='Escape')setOpen(false);if(e.key==='Enter'&&open){e.preventDefault();if(matches[active])choose(matches[active]);}}}/>{open&&<div id={id+'-results'} role="listbox" className="product-search-results">{matches.map((p,i)=><button key={p.id} id={id+'-'+i} type="button" role="option" aria-selected={i===active} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(p)}><strong>{p.name}</strong><small>{p.sku} · {p.barcode||'ไม่มีบาร์โค้ด'} · คงเหลือ {p.stockOnHand} {p.unit}</small></button>)}{!matches.length&&<p>ไม่พบสินค้า ลองค้นหาด้วยชื่อหรือรหัสอื่น</p>}{matches.length===25&&<small>แสดง 25 รายการแรก · พิมพ์เพิ่มเพื่อจำกัดผลค้นหา</small>}</div>}</div>;
}
