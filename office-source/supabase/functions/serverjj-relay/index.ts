import {createHandler} from './handler.mjs';

const env=(name:string)=>Deno.env.get(name)||'';
Deno.serve(createHandler({env}));
