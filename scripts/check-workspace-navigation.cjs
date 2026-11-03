const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict')
const swc=require('next/dist/build/swc'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
async function main(){await swc.loadBindings();
let currentPath='/messages'
const cache={}
function load(name){if(cache[name])return cache[name];const filename=path.join(process.cwd(),'components',name+'.tsx'),source=swc.transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,mod={exports:{}};const req=id=>id==='next/navigation'?{usePathname:()=>currentPath}:id==='@/lib/supabase'?{supabase:{}}:id.startsWith('@/components/')?load(id.split('/').pop()):require(id);vm.runInThisContext('(function(require,module,exports){'+source+'\n})',{filename})(req,mod,mod.exports);return cache[name]=mod.exports}
const {BrokerNavigation}=load('BrokerNavigation'),{PlatformNavigation}=load('PlatformNavigation')
const html=props=>renderToStaticMarkup(React.createElement(BrokerNavigation,props))
assert(!html({}).includes('Company &amp; staff'))
const head=html({canManageStaff:true,isHeadBroker:true});for(const target of ['/admin/company','/admin/staff','/settings/mobile-appearance','/admin/document-delivery','/billing'])assert(head.includes('href="'+target+'"'))
const delegated=html({canManageStaff:true});assert(delegated.includes('/admin/staff'));assert(!delegated.includes('/admin/document-delivery'));assert(!delegated.includes('href="/billing"'))
currentPath='/platform/partners/payouts';const owner=renderToStaticMarkup(React.createElement(PlatformNavigation));assert(/<a(?=[^>]*href="\/platform\/partners\/payouts")(?=[^>]*aria-current="page")[^>]*>Payout history/.test(owner));for(const match of owner.matchAll(/href="([^"?#]+)/g)){const href=match[1];assert(fs.existsSync(path.join(process.cwd(),'app',href,'page.tsx')),`Missing route ${href}`)}
assert(owner.includes('Finance'));assert(owner.includes('Settings'));assert(owner.includes('Operations'))
console.log('Passed: broker/staff/head navigation visibility, owner active route and menu destinations.')

}
main().catch(e=>{console.error(e);process.exitCode=1})
