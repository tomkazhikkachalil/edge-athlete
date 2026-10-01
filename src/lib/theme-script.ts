/**
 * The no-flash-of-wrong-theme script: a self-contained IIFE string injected
 * as a BLOCKING inline <script> in the root layout's <head>. It re-implements
 * resolveTheme (theme-prefs.ts) in ES5 and stamps data-theme on <html> before
 * first paint. No source, garbage JSON or disabled storage all mean "no
 * stored choice", which resolves like any absent mode: the DEFAULT SCHEDULE
 * (theme-prefs.ts — dark 6 PM to 9 AM by the device's clock). Only a script
 * that throws outright leaves the page unstamped, i.e. light.
 *
 * TWO SOURCES, IN PRIORITY ORDER:
 *   1. the `ea-theme` cookie — SERVER truth, refreshed from the account by
 *      the middleware on every document navigation (see theme-cookie.ts).
 *      Using it first is what removes the swap on a device whose stored copy
 *      is out of date, e.g. after the theme was changed on another device.
 *   2. the localStorage mirror — this device's memory, for signed-out and
 *      offline loads where no cookie is present.
 * When the cookie wins, its value is written back into the mirror so the
 * runtime evaluator (use-theme.ts, which reads the mirror) starts from the
 * same state and has nothing to correct.
 *
 * Resolution happens HERE, on the device, rather than server-side, because
 * two of the four modes cannot be resolved on a server: `scheduled` needs the
 * device's local clock, and `system` needs its OS appearance setting.
 *
 * The duplication with theme-prefs.ts is deliberate (a generated script would
 * be harder to read and debug than this) and it is PINNED by
 * src/lib/__tests__/theme-script.test.ts, which executes this string against
 * stubbed globals and asserts it agrees with resolveTheme() across the full
 * mode × window × override matrix, from both sources.
 */

import { THEME_PREFS_KEY } from './theme-storage-keys';
import { THEME_COOKIE, THEME_RESOLVED_COOKIE, THEME_COOKIE_MAX_AGE } from './theme-cookie';
import { THEME_COLOR } from './theme-colors';
import { DEFAULT_SCHEDULE } from './theme-prefs';

export const THEME_INIT_SCRIPT = `(function(){try{
var p=null;
try{
var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=([^;]*)/);
if(m&&m[1]){
var b=m[1].replace(/-/g,'+').replace(/_/g,'/');
while(b.length%4)b+='=';
var j=JSON.parse(atob(b));
if(j&&typeof j==='object'&&!(j instanceof Array))p=j;
}
}catch(e){}
if(p){try{localStorage.setItem(${JSON.stringify(THEME_PREFS_KEY)},JSON.stringify(p))}catch(e){}}
else{try{
var raw=localStorage.getItem(${JSON.stringify(THEME_PREFS_KEY)});
var q=raw?JSON.parse(raw):null;
if(q&&typeof q==='object'&&!(q instanceof Array))p=q;
}catch(e){}}
if(!p)p={};
var dark=false;
if(p.mode==='on'){dark=true}
else if(p.mode==='off'){dark=false}
else if(p.mode==='system'){dark=window.matchMedia('(prefers-color-scheme: dark)').matches}
else{
var s=p.schedule&&typeof p.schedule==='object'?p.schedule:null;
var ok=s&&typeof s.start==='number'&&typeof s.end==='number';
var st=ok?s.start:${DEFAULT_SCHEDULE.start};
var en=ok?s.end:${DEFAULT_SCHEDULE.end};
var now=new Date();
var m=now.getHours()*60+now.getMinutes();
dark=st===en?false:(st<=en?(m>=st&&m<en):(m>=st||m<en));
}
if(dark)document.documentElement.dataset.theme='dark';
else delete document.documentElement.dataset.theme;
try{
var ms=document.querySelectorAll('meta[name="theme-color"]');
for(var k=0;k<ms.length;k++)ms[k].setAttribute('content',dark?${JSON.stringify(THEME_COLOR.dark)}:${JSON.stringify(THEME_COLOR.light)});
}catch(e){}
try{
document.cookie=${JSON.stringify(THEME_RESOLVED_COOKIE)}+'='+(dark?'dark':'light')+'; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax'+(window.location.protocol==='https:'?'; Secure':'');
}catch(e){}
}catch(e){}})()`;
