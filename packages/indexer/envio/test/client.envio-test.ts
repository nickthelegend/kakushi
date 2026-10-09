import {it,expect} from 'vitest';
import {EnvioStatsClient} from '../src/client.ts';
it('normalizes maker filters and preserves missing latency and exact raw amount strings',async()=>{
 let body:{query:string;variables:Record<string,unknown>}|undefined;
 const client=new EnvioStatsClient('http://local/graphql',async(_input,init)=>{body=JSON.parse(String(init?.body));return new Response(JSON.stringify({data:{MakerStats:[{id:'0xabc',p50LatencyMs:null,latencySamples:0,fillVolumeByToken:'{"84532:0xtoken":"9007199254740993000000"}'}]}}));});
 const rows=await client.makers('0xABC',500);expect(body?.variables).toEqual({where:{id:{_eq:'0xabc'}},limit:200});expect(body?.query).toContain('MakerStats_bool_exp');expect(rows[0]).toMatchObject({p50LatencyMs:null,latencySamples:0,fillVolumeByToken:'{"84532:0xtoken":"9007199254740993000000"}'});
});
it('surfaces HTTP, GraphQL and missing-data errors instead of fabricated empty stats',async()=>{
 await expect(new EnvioStatsClient('http://local',async()=>new Response('',{status:503})).routes()).rejects.toThrow('503');
 await expect(new EnvioStatsClient('http://local',async()=>new Response(JSON.stringify({errors:[{message:'permission denied'}]}))).makers()).rejects.toThrow('permission denied');
 await expect(new EnvioStatsClient('http://local',async()=>new Response('{}')).makers()).rejects.toThrow('no data');
});
