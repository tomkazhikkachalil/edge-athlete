/**
 * The no-flash-of-wrong-theme script: a self-contained IIFE string injected
 * as a BLOCKING inline <script> in the root layout's <head>. It re-implements
 * resolveTheme (theme-prefs.ts) in ~25 lines of ES5 against the localStorage
 * mirror (ea:theme:v1) and stamps data-theme="dark" on <html> before first
 * paint. Any failure — no key, garbage JSON, storage disabled — falls through
 * to light, which is exactly the pre-dark-mode behavior.
 *
 * The duplication with theme-prefs.ts is deliberate (a generated script would
 * be harder to read and debug than 25 lines of ES5) and it is PINNED by
 * src/lib/__tests__/theme-script.test.ts, which executes this string against
 * stubbed globals and asserts it agrees with resolveTheme() across the full
 * mode × window × override matrix. Change one, and that test makes you change
 * the other.
 */

import { THEME_PREFS_KEY } from './theme-storage-keys';

export const THEME_INIT_SCRIPT = `(function(){try{
var raw=localStorage.getItem(${JSON.stringify(THEME_PREFS_KEY)});
var p=raw?JSON.parse(raw):null;
if(!p||typeof p!=='object')p={};
var dark=false;
if(p.mode==='on'){dark=true}
else if(p.mode==='system'){dark=window.matchMedia('(prefers-color-scheme: dark)').matches}
else if(p.mode==='scheduled'){
var s=p.schedule&&typeof p.schedule==='object'?p.schedule:null;
var ok=s&&typeof s.start==='number'&&typeof s.end==='number';
var st=ok?s.start:1200;
var en=ok?s.end:420;
var now=new Date();
var m=now.getHours()*60+now.getMinutes();
dark=st===en?false:(st<=en?(m>=st&&m<en):(m>=st||m<en));
var o=p.override;
if(o&&typeof o==='object'&&(o.theme==='dark'||o.theme==='light')&&typeof o.setAt==='string'){
var setAt=new Date(o.setAt).getTime();
if(!isNaN(setAt)){
var prev=-Infinity;
var bounds=[st,en];
for(var i=0;i<2;i++){for(var d=0;d>=-1;d--){
var c=new Date(now);
c.setDate(c.getDate()+d);
c.setHours(Math.floor(bounds[i]/60),bounds[i]%60,0,0);
var ct=c.getTime();
if(ct<=now.getTime()&&ct>prev)prev=ct;
}}
if(setAt>prev)dark=o.theme==='dark';
}
}
}
if(dark)document.documentElement.dataset.theme='dark';
}catch(e){}})()`;
