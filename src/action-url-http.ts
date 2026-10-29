import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

type Resolved = { address: string; family: number };
type Resolver = (hostname: string, options: { all: true; verbatim: true }) => Promise<Resolved[]>;
type ActionResponse = { status: number; ok: boolean; headers: IncomingHttpHeaders; json(): Promise<unknown>; text(): Promise<string> };
const lookup = dnsLookup as unknown as Resolver;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function blockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  const n = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
  const ranges: [number, number][] = [[0,8],[0x0a000000,8],[0x64400000,10],[0x7f000000,8],[0xa9fe0000,16],[0xac100000,12],[0xc0000000,24],[0xc0000200,24],[0xc0586300,24],[0xc0a80000,16],[0xc6120000,15],[0xc6336400,24],[0xcb007100,24],[0xe0000000,4],[0xf0000000,4]];
  return ranges.some(([base,bits]) => (n >>> (32-bits)) === (base >>> (32-bits)));
}
function blockedIPv6(ip: string): boolean {
  const value = ip.toLowerCase().split('%')[0]!;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blockedIPv4(mapped[1]!);
  // IPv4-mapped IPv6 also has a hexadecimal form (for example ::ffff:7f00:1).
  // Treat it as the embedded IPv4 address rather than allowing it through the
  // global-unicast IPv6 range check.
  const mappedHex = value.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1]!, 16);
    const low = Number.parseInt(mappedHex[2]!, 16);
    return blockedIPv4(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
  }

  // Only globally allocated unicast space (2000::/3) is eligible.
  const first = Number.parseInt(value.split(':')[0]!, 16);
  if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return true;

  // Exclude special-purpose, transition, documentation, and benchmarking space.
  if (first === 0x2001) {
    const second = Number.parseInt(value.split(':')[1] || '0', 16);
    const third = Number.parseInt(value.split(':')[2] || '0', 16);
    if (second === 0 || second === 2 || second === 0x20 || second === 0xdb8 ||
        (second === 3) || (second === 4 && third === 0x112) || second === 0x10 || second === 0x30) return true;
  }
  if (first === 0x2002) return true; // 6to4
  if (first === 0x2620 && value.startsWith('2620:4f:8000:')) return true;
  return false;
}
function blocked(ip:string):boolean{return isIP(ip)===4?blockedIPv4(ip):isIP(ip)===6?blockedIPv6(ip):true;}
export async function collectBoundedResponse(source: AsyncIterable<Uint8Array>, maxBytes: number, onLimit?: () => void): Promise<Buffer> { const chunks: Buffer[]=[]; let size=0; for await (const chunk of source) { const part=Buffer.from(chunk); size+=part.length; if(size>maxBytes) { onLimit?.(); throw new Error('OneBot action_url response exceeds size limit'); } chunks.push(part); } return Buffer.concat(chunks); }
export async function safeActionFetch(input:string|URL,init:RequestInit={},resolve:Resolver=lookup):Promise<ActionResponse>{
 const url=new URL(input); if((url.protocol!=='http:'&&url.protocol!=='https:')||url.username||url.password)throw new Error('Unsafe OneBot action_url');
 const version=isIP(url.hostname); const addresses:Resolved[]=version?[{address:url.hostname,family:version}]:await resolve(url.hostname,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(({address})=>blocked(address)))throw new Error('Unsafe OneBot action_url destination');
 const address=addresses[0]!.address;
 return await new Promise<ActionResponse>((resolveResponse,reject)=>{
  const transport=url.protocol==='https:'?httpsRequest:httpRequest;
  const headers=init.headers instanceof Headers?Object.fromEntries(init.headers.entries()):init.headers as Record<string,string>|undefined;
  const req=transport(url,{method:init.method,headers,signal:init.signal as AbortSignal|undefined,lookup:(_host,_opts,cb)=>cb(null,address,isIP(address))},res=>{
   const bodyPromise=collectBoundedResponse(res,MAX_RESPONSE_BYTES,()=>res.destroy(new Error('OneBot action_url response exceeds size limit'))).then(body=>body.toString());bodyPromise.then(body=>{const status=res.statusCode??0;resolveResponse({status,ok:status>=200&&status<300,headers:res.headers,text:async()=>body,json:async()=>JSON.parse(body)});},reject);
  });
  req.on('error',reject);
  if(init.body!==undefined&&init.body!==null)req.write(init.body as string|Buffer);
  req.end();
 });
}
