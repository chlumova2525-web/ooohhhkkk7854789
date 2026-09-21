// Všechny styly aplikace. V app.jsx to byla 40kB konstanta.
//
// Je to obyčejný text, žádná interpolace. Vkládá se přes
// <style>{CSS}</style> — samostatný .css soubor nejde, aplikace
// se nasazuje jako jediný balík.

export const CSS = `
.sd{
  --krem:#F4EEE1; --krem2:#E9DFC9; --bila:#FFFFFF;
  --les:#0C3B2E; --les2:#14503D; --lesDum:#0C3C30; --salvej:#6D9773; --salvej2:#8FB396;
  --piskovec:#C9AE85; --piskovec2:#E6D9C0; --piskovec3:#A8906A;
  --okr:#B46617; --zluta:#FFBA00;
  --text:#132C22; --text2:#5E7268; --linka:#E0D5BF; --cerven:#B03A2E;
  background:var(--krem);
  color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-size:14px; line-height:1.5; min-height:100vh; padding-bottom:80px;
}
.sd *{box-sizing:border-box;}
.n{font-variant-numeric:tabular-nums;letter-spacing:-.02em;}
.wrap{max-width:1020px;margin:0 auto;padding:0 16px;}
.eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--text2);font-weight:800;}

.hlava{padding:24px 0 2px;}
.znacka{display:flex;align-items:center;gap:14px;}
.znacka .mark{flex-shrink:0;width:46px;height:46px;background:var(--bila);border:1.5px solid var(--piskovec);border-radius:12px;display:flex;align-items:center;justify-content:center;}
.nazev{font-size:29px;font-weight:800;letter-spacing:-.03em;margin:1px 0 0;line-height:1.05;color:var(--les);}

/* ---- hrdinská karta: zelené okno v pískovcovém ostění ---- */
.hero{background:var(--les);color:#EFF5F0;border-radius:18px;padding:22px;margin-top:18px;position:relative;overflow:hidden;border:5px solid var(--piskovec2);outline:1.5px solid var(--piskovec);outline-offset:-6.5px;}
.hero::after{content:"";position:absolute;right:-80px;top:-80px;width:230px;height:230px;border-radius:50%;background:rgba(109,151,115,.16);}
.heroin{position:relative;display:flex;gap:20px;align-items:center;flex-wrap:wrap;}
.herotext{flex:1;min-width:190px;}
.herotext .eyebrow{color:var(--salvej2);}
.heroc{font-size:37px;font-weight:800;letter-spacing:-.035em;line-height:1.05;margin-top:4px;color:#fff;}
.heropod{font-size:13px;color:var(--salvej2);margin-top:5px;}
.prsten{flex-shrink:0;width:112px;height:112px;}
.dumblok{flex-shrink:0;text-align:center;}
.dumblok svg{display:block;width:246px;height:auto;}
.dumblok figcaption{font-size:11px;color:var(--salvej2);margin-top:6px;font-weight:700;letter-spacing:.04em;}
@media (max-width:900px){.dumblok{display:none;}}

.lat{margin-top:20px;position:relative;}
.latbar{display:flex;height:12px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.14);}
.latseg{position:relative;flex-basis:0;overflow:hidden;border-right:2px solid var(--les);}
.latseg:last-child{border-right:none;}
.latbg{position:absolute;inset:0;opacity:.28;}
.latfill{position:absolute;left:0;top:0;bottom:0;transition:width .6s cubic-bezier(.2,.8,.2,1);}
.latpopis{display:flex;margin-top:11px;gap:4px;flex-wrap:wrap;}
.latitem{flex-basis:0;min-width:96px;padding-right:10px;}
.latitem .tec{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;}
.latitem .lbl{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:var(--salvej2);}
.latitem b{display:block;font-size:15px;font-weight:800;color:#fff;margin-top:2px;}
.latitem span.z{font-size:11.5px;color:var(--salvej2);}

/* ---- dlaždice: bílá stěna, pískovcový sokl ---- */
.dlazdice{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin-top:14px;}
.dl{background:var(--bila);border-radius:14px;padding:15px;border:1px solid var(--linka);border-bottom:4px solid var(--piskovec2);}
.dl .ikonka{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:11px;}
.dl small{display:block;font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--text2);font-weight:800;}
.dl b{display:block;font-size:23px;font-weight:800;letter-spacing:-.03em;margin-top:3px;}
.dl em{font-style:normal;font-size:11.5px;color:var(--text2);display:block;margin-top:3px;}

.dvojka{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:14px;}

.box{background:var(--bila);border:1px solid var(--linka);border-radius:14px;padding:18px;margin-top:14px;}
.boxh{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;margin:0 0 14px;display:flex;justify-content:space-between;gap:12px;align-items:center;color:var(--les);}
.boxh span{letter-spacing:0;text-transform:none;font-size:12px;color:var(--text2);font-weight:600;}
.boxh .hi{display:flex;align-items:center;gap:9px;letter-spacing:.14em;text-transform:uppercase;font-size:11px;color:var(--les);font-weight:800;}
.boxh .hi i{width:28px;height:28px;border-radius:8px;background:var(--piskovec2);display:flex;align-items:center;justify-content:center;flex-shrink:0;}

.karty{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:12px;}
.karta{background:var(--bila);border:1px solid var(--linka);border-bottom:4px solid var(--piskovec2);border-radius:14px;padding:14px 15px 15px;}
.karta small{display:block;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--text2);font-weight:800;margin-bottom:5px;}
.karta b{font-size:21px;font-weight:800;letter-spacing:-.03em;display:block;}
.karta em{font-style:normal;font-size:11.5px;color:var(--text2);display:block;margin-top:3px;}

table.t{width:100%;border-collapse:collapse;font-size:13.5px;}
table.t th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);font-weight:800;padding:0 8px 8px 0;border-bottom:1.5px solid var(--piskovec2);}
table.t td{padding:9px 8px 9px 0;border-bottom:1px solid var(--linka);vertical-align:middle;}
table.t tr:last-child td{border-bottom:none;}
.r{text-align:right;}
.nowrap{white-space:nowrap;}

.stitek{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:3px 7px;border-radius:6px;white-space:nowrap;}
.znak{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;font-size:11px;font-weight:800;border-radius:7px;}

.tabs{display:flex;gap:6px;margin:20px 0 16px;overflow-x:auto;padding-bottom:2px;}
.tab{display:inline-flex;align-items:center;gap:7px;background:var(--krem2);border:none;border-radius:9px;padding:9px 14px;font:inherit;font-size:13px;font-weight:700;color:var(--text2);cursor:pointer;white-space:nowrap;}
.tabpopis{font-size:12.5px;color:var(--text2);margin:14px 0 4px;line-height:1.4;text-align:center;}

@media (max-width:560px){
  .pozor{padding:10px 12px;gap:9px;margin:12px -16px 0;border-radius:0;}
  .pozorik{width:28px;height:28px;border-radius:8px;}
  .pozortext{font-size:12.5px;}
  .pozorbtn{padding:8px 12px;font-size:11.5px;}
  .wrap{padding:0 14px;}
}

.zalozkyBlok{display:flex;align-items:center;gap:4px;margin-top:18px;}
.zalSip{flex-shrink:0;width:26px;height:56px;background:none;border:none;color:var(--piskovec);font-size:24px;font-weight:400;cursor:pointer;line-height:1;padding:0;}
.zalSip:hover{color:var(--les);}
.zalPas{display:flex;gap:9px;overflow-x:auto;padding:3px 2px;scrollbar-width:none;-ms-overflow-style:none;scroll-snap-type:x proximity;}
.zalPas::-webkit-scrollbar{display:none;}
.zalKarta{flex:0 0 auto;min-width:92px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;background:var(--bila);border:1px solid var(--linka);border-radius:17px;padding:13px 15px;font:inherit;font-size:12.5px;font-weight:700;color:var(--text2);cursor:pointer;scroll-snap-align:center;transition:background .15s,color .15s,border-color .15s;}
.zalKarta:hover{border-color:var(--salvej);color:var(--les);}
.zalKarta[data-a="1"]{background:var(--les);border-color:var(--les);color:#fff;box-shadow:0 4px 14px rgba(12,59,46,.22);}
.zalKarta[data-poz="1"]{background:var(--zluta);border-color:var(--zluta);color:var(--les);}
.zalKarta[data-poz="1"][data-a="1"]{background:var(--les);border-color:var(--les);color:var(--zluta);}
.zalTecky{display:flex;justify-content:center;gap:7px;margin-top:11px;}
.zalTecky i{display:block;width:16px;height:4px;border-radius:99px;background:var(--piskovec2);transition:width .25s,background .25s;}
.zalTecky i[data-a="1"]{width:34px;background:var(--les);}
@media (max-width:460px){
  .zalKarta{min-width:78px;padding:11px 12px;font-size:11.5px;}
  .zalSip{width:20px;}
}
.podtabs{display:flex;gap:4px;margin-top:14px;border-bottom:1.5px solid var(--linka);overflow-x:auto;}
.podtab{background:none;border:none;border-bottom:3px solid transparent;padding:9px 14px;font:inherit;font-size:13px;font-weight:700;color:var(--text2);cursor:pointer;white-space:nowrap;margin-bottom:-1.5px;}
.podtab:hover{color:var(--les);}
.podtab[data-a="1"]{color:var(--les);border-bottom-color:var(--zluta);}
.tab:hover{background:var(--piskovec2);color:var(--les);}
.tab[data-a="1"]{background:var(--les);color:var(--krem);}

.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:11px;align-items:end;}
.pole label{display:block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);font-weight:800;margin-bottom:5px;}
.pole input,.pole select{width:100%;background:var(--krem);border:1.5px solid var(--linka);padding:9px 11px;font:inherit;font-size:14px;color:var(--text);border-radius:8px;}
.pole input:focus,.pole select:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.25);}
.mini{width:100%;background:var(--krem);border:1.5px solid var(--linka);padding:6px 8px;font:inherit;font-size:13px;color:var(--text);border-radius:7px;}
.mini:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.22);}
.chk{display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;user-select:none;padding-bottom:9px;}
.chk input{width:17px;height:17px;accent-color:#0C3B2E;}
.btn{background:var(--les);color:var(--krem);border:none;padding:11px 20px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;border-radius:9px;}
.btn:hover{background:var(--les2);}
.btn:disabled{opacity:.45;cursor:default;}
.btn2{background:var(--piskovec2);color:var(--les);border:none;padding:10px 16px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;}
.btn2:hover{background:var(--piskovec);}
.x{background:none;border:none;color:var(--piskovec);cursor:pointer;font-size:17px;padding:0 4px;line-height:1;}
.x:hover{color:var(--cerven);}

.pruh{height:9px;background:var(--krem2);border-radius:99px;position:relative;overflow:hidden;min-width:52px;}
.pruh i{position:absolute;left:0;top:0;bottom:0;display:block;border-radius:99px;}

.brana{max-width:420px;margin:0 auto;padding:48px 16px;}
.branaKarta{position:relative;background:var(--bila);border:6px solid var(--les);border-radius:24px;padding:30px 26px 26px;box-shadow:0 18px 46px rgba(12,59,46,.16);}
.branaKarta::before{content:"";position:absolute;inset:-14px;border:2px solid var(--salvej);border-radius:32px;opacity:.35;pointer-events:none;}
.branaKarta .nazev{font-size:24px;}
.odkazTlac{display:block;width:100%;background:none;border:none;margin-top:14px;padding:6px;font:inherit;font-size:13px;font-weight:700;color:var(--salvej);text-decoration:underline;text-underline-offset:3px;cursor:pointer;}
.odkazTlac:hover{color:var(--les);}

.volba{display:flex;align-items:center;gap:15px;width:100%;background:var(--bila);border:2px solid var(--linka);border-radius:16px;padding:16px 18px;margin-top:12px;font:inherit;text-align:left;cursor:pointer;color:var(--text);}
.volba:hover{border-color:var(--salvej);background:#FBF9F3;}
.volbaIkona{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.volbaText{flex:1;min-width:0;}
.volba b{display:block;font-size:17px;font-weight:800;color:var(--les);letter-spacing:-.02em;}
.volba small{display:block;font-size:12.5px;color:var(--text2);margin-top:3px;}
.volbaZnak{background:var(--zluta);color:var(--les);font-weight:800;font-size:13px;border-radius:99px;padding:4px 11px;flex-shrink:0;}

.poleOko{position:relative;display:block;}
.poleOko input{width:100%;padding-right:46px;}
.okoBtn{position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:7px;color:var(--piskovec3);display:flex;border-radius:8px;}
.okoBtn:hover{color:var(--les);background:var(--krem);}
.zustat{display:flex;align-items:center;gap:10px;margin-top:14px;font-size:13.5px;font-weight:600;color:var(--text2);cursor:pointer;}
.zustat input{width:18px;height:18px;accent-color:#0C3B2E;flex-shrink:0;}
.branaKarta .btn{width:100%;justify-content:center;padding:13px 20px;font-size:15px;}
.branaKarta .btn2{width:100%;}
@media (max-width:460px){
  .brana{padding:32px 14px;}
  .branaKarta{padding:24px 18px 20px;border-width:5px;}
  .branaKarta::before{inset:-10px;border-radius:28px;}
}
.prazdno{color:var(--text2);font-size:13.5px;padding:18px 0;text-align:center;}
.pozn{font-size:12px;color:var(--text2);line-height:1.55;margin-top:12px;}
.rada{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:16px;}

.skener{border:2px dashed var(--piskovec);background:var(--bila);border-radius:14px;padding:18px;margin-top:14px;}
.drop{border:2px dashed var(--linka);background:var(--krem);padding:30px 16px;text-align:center;cursor:pointer;border-radius:12px;display:block;}
.drop:hover{border-color:var(--salvej);background:#FBF7EE;}
.drop b{display:block;font-size:15.5px;font-weight:800;margin-bottom:4px;color:var(--les);}
.drop span{font-size:12.5px;color:var(--text2);}
.nahled{max-width:150px;border-radius:10px;border:1px solid var(--linka);display:block;}
.spin{display:inline-block;width:15px;height:15px;border:2.5px solid var(--krem2);border-top-color:var(--les);border-radius:50%;animation:ot .8s linear infinite;vertical-align:-3px;margin-right:9px;}
@keyframes ot{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}.latfill,.prstenk,.okno{transition:none}}
.hlaska{border-radius:10px;background:rgba(255,186,0,.16);border-left:4px solid var(--zluta);padding:11px 14px;font-size:13px;margin-top:13px;}
.hlaska.zle{background:rgba(176,58,46,.1);border-left-color:var(--cerven);}
.hlaska.dobre{background:rgba(109,151,115,.16);border-left-color:var(--salvej);}

.mriz{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;}
.fa{border:1px solid var(--linka);border-radius:12px;overflow:hidden;background:var(--krem);}
.faobr{display:block;width:100%;height:150px;padding:0;border:none;background:#fff;cursor:pointer;overflow:hidden;}
.faobr img{width:100%;height:100%;object-fit:cover;object-position:top;display:block;}
.faobr.prazdna{display:flex;align-items:center;justify-content:center;background:var(--krem2);color:var(--text2);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;cursor:default;font-weight:800;}
.fatext{padding:11px 12px 12px;}
.fatext b{display:block;font-size:14px;font-weight:800;line-height:1.25;color:var(--les);}
.fatext span{display:block;font-size:11.5px;color:var(--text2);margin-top:2px;}
.fabtny{display:flex;gap:12px;margin-top:9px;}
.odkaz{background:none;border:none;padding:0;font:inherit;font-size:11.5px;font-weight:700;color:var(--text2);cursor:pointer;text-decoration:underline;text-underline-offset:2px;}
.odkaz:hover{color:var(--cerven);}
.lupa{position:fixed;inset:0;background:rgba(12,59,46,.94);z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;}
.lupa img{max-width:100%;max-height:88vh;object-fit:contain;border-radius:6px;}
.lupax{position:absolute;top:16px;right:16px;background:var(--krem);border:none;color:var(--les);padding:10px 18px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;border-radius:9px;}

.stavy{display:flex;gap:10px;flex-wrap:wrap;}
.stavc{flex:1;min-width:112px;background:var(--krem);border-radius:11px;padding:13px 14px;display:flex;align-items:center;gap:11px;}
.stavc b{font-size:22px;font-weight:800;line-height:1;display:block;}
.stavc small{font-size:11px;color:var(--text2);font-weight:700;letter-spacing:.06em;text-transform:uppercase;}

.srov{margin-top:2px;}
.srovbar{display:flex;height:24px;border-radius:6px;overflow:hidden;background:var(--krem2);}
.srovbar i{display:block;height:100%;}
.srovleg{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px;}
.srovleg span{display:flex;align-items:center;gap:6px;color:var(--text2);}
.srovleg u{width:11px;height:11px;border-radius:2px;display:block;}
.okno{transition:fill .5s ease;}


/* ---- hlavička přehledu ---- */
.heroV{position:relative;background:var(--lesDum);border:5px solid var(--piskovec2);border-radius:22px;padding:26px 28px 22px;margin-top:18px;color:#EFF5F0;overflow:hidden;}
.heroVrch{display:grid;grid-template-columns:minmax(220px,1.4fr) 128px minmax(240px,1fr);align-items:center;gap:22px;}
.heroUkoly{display:none;font-size:13px;color:var(--salvej2);font-weight:600;margin-top:10px;}
.heroText .eyebrow{letter-spacing:.22em;}
.heroCislo{font-size:clamp(34px,5vw,52px);font-weight:800;letter-spacing:-.04em;line-height:1.02;color:#fff;margin-top:8px;}
.heroPod{font-size:13.5px;color:var(--salvej2);margin-top:10px;line-height:1.5;}
.heroPrsten{width:128px;height:128px;justify-self:center;}
.heroDum{margin:0;justify-self:end;width:100%;}
.heroDum img{display:block;width:100%;max-width:440px;margin-left:auto;}
.heroDum figcaption{text-align:right;font-size:13px;color:var(--salvej2);margin-top:8px;font-weight:600;}
.heroPruh{display:flex;gap:4px;height:14px;margin-top:20px;}
.heroSeg{position:relative;flex-basis:0;min-width:8px;background:rgba(255,255,255,.13);border-radius:99px;overflow:hidden;}
.heroSeg i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;transition:width .7s cubic-bezier(.2,.8,.2,1);}
.heroPruhPopis{display:flex;justify-content:space-between;gap:12px;margin-top:9px;font-size:12.5px;color:var(--salvej2);}
.heroPruhPopis b{color:#fff;font-weight:800;}
.heroZdroje{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px;margin-top:22px;padding-top:20px;border-top:1px solid rgba(255,255,255,.12);}
.zdrojKarta{display:flex;align-items:center;gap:14px;}
.zdrojIkona{width:54px;height:54px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.zdrojKarta{align-items:flex-start;}
.zdrojText{flex:1;min-width:0;}
.zdrojKarta small{display:block;font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;font-weight:800;}
.zdrojKarta b{display:block;font-size:23px;font-weight:800;letter-spacing:-.03em;color:#fff;margin-top:4px;line-height:1.1;}
.zdrojKarta b em{font-style:normal;font-size:12px;font-weight:700;color:var(--salvej2);letter-spacing:.04em;text-transform:uppercase;margin-left:6px;}
.zdrojPruh{display:block;height:6px;border-radius:99px;background:rgba(255,255,255,.14);margin-top:9px;overflow:hidden;}
.zdrojPruh i{display:block;height:100%;border-radius:99px;transition:width .7s cubic-bezier(.2,.8,.2,1);}
.zdrojPod{display:block;font-size:11.5px;color:var(--salvej2);margin-top:6px;}
@media (max-width:900px){
  .heroVrch{grid-template-columns:1fr auto;align-items:center;gap:16px;}
  .heroDum{display:none;}
  .heroUkoly{display:block;}
  .heroPrsten{width:104px;height:104px;justify-self:end;}
}
@media (max-width:460px){
  .heroV{padding:20px 18px 18px;}
  .heroPrsten{width:88px;height:88px;}
  .heroZdroje{gap:14px;margin-top:18px;padding-top:16px;}
  .zdrojIkona{width:46px;height:46px;}
  .zdrojKarta b{font-size:21px;}
}

/* ---- rozpočet podle návrhu ---- */
.filtrPas{position:relative;background:var(--les);border-radius:18px;padding:14px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;overflow:hidden;margin-top:14px;}
.listy{position:absolute;right:6px;top:2px;width:130px;height:76px;pointer-events:none;}
.filtrTlac{position:relative;background:transparent;border:1.5px solid rgba(255,255,255,.45);color:#EFF5F0;border-radius:99px;padding:9px 18px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:8px;}
.filtrTlac:hover{border-color:#fff;}
.filtrTlac[data-a="1"]{background:#fff;color:var(--les);border-color:#fff;}
.filtrTlac[data-jemny="1"]{background:rgba(255,255,255,.14);border-color:transparent;}
.filtrTlac[data-jemny="1"]:hover{background:rgba(255,255,255,.24);}
.filtrHledej{position:relative;flex:1;min-width:180px;}
.filtrHledej input{width:100%;background:rgba(255,255,255,.14);border:1.5px solid rgba(255,255,255,.3);border-radius:99px;padding:9px 16px;font:inherit;font-size:13.5px;color:#fff;}
.filtrHledej input::placeholder{color:rgba(239,245,240,.6);}
.filtrHledej input:focus{outline:none;border-color:var(--zluta);}

.diskSeznam{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;}
.diskSeznam li{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;background:var(--krem);border-radius:10px;padding:9px 12px;font-size:13px;}
.diskSeznam b{color:var(--les);font-weight:700;}
.diskSeznam span{color:var(--text2);font-size:12px;}
.diskSeznam li span:last-child{margin-left:auto;color:var(--text);font-size:13px;}

.fakturyMriz{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;}
.fakturaKarta{background:var(--bila);border:1.5px solid rgba(109,151,115,.45);border-radius:14px;padding:12px;}
.fakturaKarta[data-disk="1"]{border-color:#3E6B4C;background:#FAFCFA;}
.fakturaFoto{display:block;width:100%;height:150px;object-fit:cover;border-radius:10px;background:var(--krem2);cursor:pointer;border:1px solid var(--linka);}
.fakturaNacitam{display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text2);cursor:default;}
.fakturaText{margin-top:9px;}
.fakturaText b{display:block;font-size:14px;font-weight:700;color:var(--les);line-height:1.25;}
.fakturaText small{display:block;font-size:11.5px;color:var(--text2);margin:3px 0 4px;}

.fakturniRadky{background:var(--krem);border-radius:14px;padding:14px;margin-top:12px;}
.fakturniR{display:flex;align-items:center;gap:12px;background:var(--bila);border:1.5px solid rgba(109,151,115,.4);border-radius:11px;padding:10px 12px;cursor:pointer;}
.fakturniR[data-prirazeno="1"]{opacity:.5;background:var(--krem2);cursor:default;}
.fakturniR input[type="checkbox"]{width:18px;height:18px;accent-color:#0C3B2E;flex-shrink:0;}
.fakturniText{flex:1;min-width:0;}
.fakturniText b{display:block;font-size:13.5px;font-weight:700;color:var(--les);line-height:1.3;}
.fakturniText small{display:block;font-size:11px;color:var(--text2);margin-top:2px;}

.poznamkaPole{width:100%;min-height:82px;background:var(--krem);border:1.5px solid var(--linka);border-radius:12px;padding:11px 13px;font:inherit;font-size:14px;line-height:1.5;color:var(--text);resize:vertical;}
.poznamkaPole:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.22);}

.upominkySeznam{display:flex;flex-direction:column;gap:8px;}
.upominka{display:flex;align-items:flex-start;gap:12px;background:var(--krem);border:1.5px solid rgba(109,151,115,.4);border-radius:12px;padding:11px 13px;}
.upominka[data-hotovo="1"]{opacity:.55;background:var(--bila);}
.upominka[data-hotovo="1"] .upominkaText b{text-decoration:line-through;}
.upominkaText{flex:1;min-width:0;}
.upominkaText b{display:block;font-size:14px;font-weight:700;color:var(--les);line-height:1.35;}
.upominkaText small{display:block;font-size:11.5px;color:var(--text2);margin-top:3px;}

.pridatKarta{display:flex;align-items:center;gap:14px;width:100%;background:var(--bila);border:1px solid var(--linka);border-radius:18px;padding:16px 18px;margin-top:14px;font:inherit;font-size:15px;font-weight:700;color:var(--les);cursor:pointer;}
.pridatKarta:hover{border-color:var(--salvej);background:#FBF9F3;}
.pridatPlus{width:38px;height:38px;border-radius:11px;background:var(--krem);display:flex;align-items:center;justify-content:center;flex-shrink:0;}

.skupinaKarta{background:var(--bila);border:1px solid var(--linka);border-radius:20px;margin-top:14px;overflow:hidden;}
.skupinaHlava{display:grid;grid-template-columns:64px minmax(150px,1.6fr) repeat(3,minmax(84px,.9fr)) 110px 26px;align-items:center;gap:12px;width:100%;background:none;border:none;padding:16px 18px;font:inherit;text-align:left;cursor:pointer;color:var(--text);}
.skupinaHlava:hover{background:#FBF9F3;}
.skupinaIkona{width:56px;height:56px;border-radius:50%;background:var(--krem);border:2px solid;display:flex;align-items:center;justify-content:center;}
.skupinaNazev b{display:block;font-size:17px;font-weight:800;letter-spacing:-.02em;line-height:1.2;}
.skupinaNazev small{display:block;font-size:12.5px;color:var(--text2);margin-top:3px;}
.sloupceSk{display:contents;}
.cisla{display:contents;}
.sloupec small{display:block;font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--text2);font-weight:800;}
.sloupec b{display:block;font-size:16px;font-weight:800;letter-spacing:-.02em;margin-top:3px;white-space:nowrap;}
.skupinaPruh{display:block;height:9px;border-radius:99px;background:var(--krem2);position:relative;overflow:hidden;}
.skupinaPruh i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;}
.skupinaTelo{padding:0 12px 12px;}

.polozkaR{display:grid;grid-template-columns:34px minmax(150px,1.6fr) repeat(3,minmax(84px,.9fr)) 110px 26px 26px;align-items:center;gap:12px;background:var(--bila);border:1.5px solid rgba(109,151,115,.5);border-radius:14px;padding:12px 14px;margin-top:8px;}
.polozkaR:hover{border-color:var(--salvej);}
.polozkaNazev b{display:block;font-size:14px;font-weight:700;line-height:1.25;color:var(--les);}
.polozkaNazev small{display:block;font-size:12px;color:var(--text2);margin-top:2px;}
.stavPilulka{display:inline-block;margin-left:8px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-radius:6px;padding:2px 7px;vertical-align:2px;}
.ctaDetail{background:var(--zluta);border:1.5px solid var(--zluta);border-radius:10px;padding:9px 16px;font:inherit;font-size:12.5px;font-weight:800;color:var(--les);cursor:pointer;white-space:nowrap;}
.ctaDetail:hover{background:var(--les);border-color:var(--les);color:var(--zluta);}

.stitekNavic{display:inline-block;margin-left:7px;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#B46617;background:#F7E7D6;border-radius:6px;padding:2px 6px;vertical-align:1px;}

.stavKolecko{width:26px;height:26px;border-radius:50%;border:2px solid var(--linka);background:var(--bila);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}
.stavKolecko[data-stav="hotovo"]{background:#3E6B4C;border-color:#3E6B4C;}
.stavKolecko[data-stav="probiha"]{border-color:#D98C0A;}
.stavKolecko .pulka{width:11px;height:11px;border-radius:50%;background:#D98C0A;}
.stavKolecko:hover{border-color:var(--salvej);}

.odhadPole input{width:100%;background:var(--krem);border:1.5px solid var(--linka);border-radius:10px;padding:8px 10px;font:inherit;font-size:14px;font-weight:700;text-align:center;color:var(--text);}
.odhadPole input:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.22);}
.skutPole b,.rozdilPole b{display:block;font-size:14px;font-weight:700;text-align:center;}
.cisla small{display:none;}
.stavStitek{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;white-space:nowrap;}
.detailSipka{background:none;border:none;color:var(--piskovec);font-size:17px;font-weight:800;cursor:pointer;padding:0;line-height:1;}
.detailSipka:hover{color:var(--okr);}
.polozkaSmaz{display:flex;justify-content:flex-end;}

.viceTlac{display:block;width:100%;background:none;border:none;border-top:1px dashed var(--linka);margin-top:8px;padding:12px;font:inherit;font-size:13.5px;font-weight:700;color:var(--salvej);cursor:pointer;}
.viceTlac:hover{color:var(--les);}

@media (max-width:760px){
  .tKarty thead{display:none;}
  .tKarty,.tKarty tbody,.tKarty tr,.tKarty td{display:block;width:100%;}
  .tKarty tr{background:var(--bila);border:1.5px solid rgba(109,151,115,.45);border-radius:14px;padding:12px 14px;margin-top:10px;}
  .tKarty td{border-bottom:none!important;padding:3px 0;text-align:left!important;}
  .tKarty td[data-popis]{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 0;border-top:1px solid var(--linka)!important;}
  .tKarty td[data-popis]::before{content:attr(data-popis);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);font-weight:800;flex-shrink:0;}
  .tKarty td[data-popis] .mini{width:130px;text-align:right;}
  .tKarty .bunkaDatum{font-size:11.5px;font-weight:700;}
  .tKarty .bunkaPopis{font-size:15px;font-weight:700;color:var(--les);line-height:1.3;padding-bottom:6px;}
  .tKarty .bunkaCastka{font-size:16px;font-weight:800;}
  .tKarty tr[style*="border-top"]{background:var(--krem2);}
  .box{max-width:100%;overflow-x:auto;}
}

.patka{display:flex;align-items:center;gap:14px;background:var(--krem2);border-radius:16px;padding:14px 18px;margin-top:18px;flex-wrap:wrap;}
.patkaI{width:34px;height:34px;border-radius:50%;background:var(--les);color:var(--zluta);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0;}
.patka p{flex:1;margin:0;font-size:13px;color:var(--text2);min-width:180px;}

@media (max-width:900px){
  .skupinaHlava{
    grid-template-columns:48px minmax(0,1fr) 26px;
    grid-template-areas:"ikona nazev sipka" "cisla cisla cisla" "pruh pruh pruh";
    gap:12px;padding:14px;
  }
  .skupinaIkona{grid-area:ikona;width:48px;height:48px;}
  .skupinaNazev{grid-area:nazev;}
  .skupinaNazev b{font-size:17px;}
  .skupinaHlava .sipka{grid-area:sipka;}
  .sloupceSk{grid-area:cisla;display:flex;gap:10px;}
  .sloupceSk .sloupec{flex:1;min-width:0;}
  .sloupceSk .sloupec b{font-size:14px;}
  .skupinaPruh{grid-area:pruh;}
  .skupinaTelo{padding:0 8px 8px;}

  .polozkaR{
    grid-template-columns:28px minmax(0,1fr) 24px;
    grid-template-areas:"stav nazev smaz" "cisla cisla cisla" "cta cta cta";
    gap:12px 10px;padding:16px 14px;
  }
  .polozkaR .stavKolecko{grid-area:stav;width:28px;height:28px;}
  .polozkaNazev{grid-area:nazev;}
  .polozkaNazev b{display:block;font-size:15px;font-weight:700;letter-spacing:-.01em;line-height:1.25;color:var(--les);}
  .polozkaNazev .stavPilulka{display:inline-block;margin:7px 0 0;vertical-align:0;font-size:10.5px;}
  .polozkaNazev small{font-size:12.5px;margin-top:5px;}
  .polozkaSmaz{grid-area:smaz;justify-self:end;}

  .cisla{grid-area:cisla;display:block;border-top:1px solid var(--linka);}
  .cisla > span{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 2px;border-bottom:1px solid var(--linka);}
  .cisla small{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);font-weight:800;margin:0;text-align:left;}
  .odhadPole input{width:132px;text-align:right;font-size:16px;padding:9px 12px;}
  .skutPole b,.rozdilPole b{text-align:right;font-size:17px;font-weight:800;}

  .polozkaR .ctaDetail{grid-area:cta;justify-self:start;font-size:13.5px;padding:11px 20px;}
}


.vchod{display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:var(--bila);border:1px solid var(--linka);border-bottom:4px solid var(--piskovec2);border-radius:14px;padding:16px;margin-bottom:12px;cursor:pointer;font:inherit;color:var(--text);}
.vchod:hover{border-color:var(--salvej);}
.vchod b{display:block;font-size:16px;font-weight:800;color:var(--les);}
.vchod small{display:block;font-size:12px;color:var(--text2);margin-top:2px;}
.vikona{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.odznak{margin-left:auto;background:var(--zluta);color:var(--les);font-size:12px;font-weight:800;border-radius:99px;min-width:24px;height:24px;display:flex;align-items:center;justify-content:center;padding:0 7px;}

.velkytlac{background:var(--bila);border:1px solid var(--linka);border-bottom:4px solid var(--piskovec2);border-radius:14px;padding:22px 16px;cursor:pointer;font:inherit;color:var(--text);text-align:center;}
.velkytlac:hover{border-color:var(--salvej);}
.velkytlac .vikona{margin:0 auto 12px;}
.velkytlac b{display:block;font-size:17px;font-weight:800;color:var(--les);}
.velkytlac small{display:block;font-size:12.5px;color:var(--text2);margin-top:3px;}

.hodinari{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;}
.hodinar{display:flex;align-items:center;gap:9px;background:var(--krem);border-radius:11px;padding:10px 12px;}
.hodinar label{flex:1;font-size:13.5px;font-weight:700;color:var(--les);}
.hodSazba{display:block;font-size:11px;color:var(--text2);font-weight:600;margin-top:1px;}
.hodinar input{width:66px;background:var(--bila);border:1.5px solid var(--linka);border-radius:8px;padding:9px;font:inherit;font-size:17px;font-weight:700;text-align:center;color:var(--text);}
.hodinar input:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.25);}
.hodinar span{font-size:12px;color:var(--text2);font-weight:700;}

.soucet{display:flex;justify-content:space-between;align-items:center;background:var(--les);color:#fff;border-radius:12px;padding:14px 18px;margin-top:16px;}
.soucet span{font-size:13px;color:var(--salvej2);font-weight:700;}
.soucet b{font-size:24px;font-weight:800;letter-spacing:-.03em;}

.rozcest{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:14px;}
.mesicpas{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;background:var(--les);color:#fff;border-radius:16px;padding:18px 20px;margin-top:18px;border:5px solid var(--piskovec2);}
.mesicpas .eyebrow{color:var(--salvej2);display:block;}
.mesicpas b{display:block;font-size:32px;font-weight:800;letter-spacing:-.035em;line-height:1.05;margin-top:3px;}
.mesicpas small{display:block;font-size:13px;color:var(--salvej2);margin-top:2px;}
.mesicpravo{text-align:right;}
.mesicpravo b{font-size:22px;color:var(--zluta);}

.pozor{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:12px;background:var(--zluta);color:var(--les);padding:13px 16px;margin:14px -16px 0;border-radius:12px;box-shadow:0 3px 14px rgba(12,59,46,.18);}
.pozorik{width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.pozortext{flex:1;font-size:13.5px;line-height:1.35;}
.pozorbtn{background:var(--les);color:var(--zluta);border:none;padding:9px 15px;font:inherit;font-size:12.5px;font-weight:800;border-radius:9px;cursor:pointer;flex-shrink:0;}
.pozorbtn:hover{background:var(--les2);}

.modal{position:fixed;inset:0;background:rgba(12,59,46,.62);z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;}
.modalkarta{background:var(--bila);border-radius:18px;border-top:7px solid var(--zluta);padding:26px;max-width:430px;width:100%;box-shadow:0 20px 60px rgba(12,59,46,.35);}
.modalik{width:60px;height:60px;border-radius:16px;background:#F7E7D6;display:flex;align-items:center;justify-content:center;margin-bottom:16px;}
.modalnadpis{font-size:22px;font-weight:800;letter-spacing:-.025em;color:var(--les);margin:0 0 8px;line-height:1.15;}
.modaltext{font-size:14px;color:var(--text2);margin:0;line-height:1.55;}

.rozpadk{margin-top:8px;display:flex;flex-direction:column;gap:4px;align-items:flex-end;}
.rozpadk span{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--salvej2);}
.rozpadk u{width:9px;height:9px;border-radius:2px;display:block;text-decoration:none;}
.rozpadk b{color:#fff;font-weight:800;}

.fotoblok{flex-shrink:0;width:230px;}
.fotoTlac{display:block;width:100%;padding:0;border:1.5px solid var(--piskovec);border-radius:10px;background:#fff;cursor:zoom-in;overflow:hidden;}
.fotoTlac img{display:block;width:100%;max-height:300px;object-fit:cover;object-position:top;}
.fotoTlac:hover{border-color:var(--salvej);}
.fotoPopis{display:block;font-size:11px;color:var(--text2);text-align:center;margin-top:5px;font-weight:700;}
.fotoCeka{border:1.5px dashed var(--linka);border-radius:10px;padding:26px 12px;text-align:center;font-size:12.5px;color:var(--text2);font-weight:700;}
@media (max-width:640px){.fotoblok{width:100%;}}

.combo{position:relative;width:100%;}
.combolist{position:absolute;z-index:35;top:100%;left:0;right:0;min-width:230px;background:#fff;border:1.5px solid var(--linka);border-radius:10px;margin-top:4px;max-height:240px;overflow:auto;box-shadow:0 10px 28px rgba(12,59,46,.2);text-align:left;}
.comboitem{display:block;width:100%;text-align:left;background:none;border:none;padding:9px 12px;font:inherit;font-size:13.5px;color:var(--text);cursor:pointer;}
.comboitem:hover{background:var(--krem);}
.comboitem.nova{color:var(--okr);font-weight:700;border-top:1px solid var(--linka);}
.comboodhad{color:var(--text2);font-size:11.5px;}
.comboprazdno{padding:10px 12px;font-size:12.5px;color:var(--text2);}

.potvrz{display:inline-flex;align-items:center;gap:7px;background:#F7DED9;border-radius:9px;padding:5px 9px;white-space:nowrap;}
.potvrzT{font-size:11.5px;font-weight:700;color:#B03A2E;}
.potvrzAno{background:#B03A2E;color:#fff;border:none;border-radius:7px;padding:5px 10px;font:inherit;font-size:11.5px;font-weight:800;cursor:pointer;}
.potvrzNe{background:none;border:none;color:#5E7268;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer;text-decoration:underline;}

.vraceno{background:#F7DED9;border-radius:10px;padding:11px 13px;margin-bottom:8px;}
.vraceno b{display:block;font-size:13.5px;color:var(--les);line-height:1.35;}
.vraceno span{display:block;font-size:13px;color:#B03A2E;margin-top:4px;font-weight:700;}

.skupinaR{cursor:pointer;transition:filter .15s;}
.skupinaR:hover{filter:brightness(.96);}
.skupinaR td{border-bottom:none!important;padding-top:14px;padding-bottom:14px;}
.skupinaR td:first-child{padding-left:12px;border-radius:10px 0 0 10px;}
.skupinaR td:last-child{border-radius:0 10px 10px 0;padding-right:12px;}
.skupinaR b{font-size:15px;font-weight:800;letter-spacing:-.01em;display:block;}
.sipka{display:inline-block;font-size:19px;font-weight:800;line-height:1;transition:transform .2s;transform-origin:center;}
.sipka[data-open="0"]{transform:rotate(-90deg);}
.skupinaPocet{display:block;font-size:11.5px;color:var(--text2);font-weight:600;margin-top:2px;}
.zalohaPole{width:100%;min-height:110px;margin-top:10px;background:var(--krem);border:1.5px solid var(--linka);border-radius:10px;padding:10px 12px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;color:var(--text2);resize:vertical;}
.zalohaPole:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.22);}

.presunR{display:block;margin-top:5px;min-width:150px;}
.presunR .mini{font-size:11.5px;padding:4px 7px;border-style:dashed;border-color:var(--piskovec);}
.presunR .mini:focus{border-style:solid;}

.dokladR{display:block;font-size:11.5px;color:var(--text2);margin-top:2px;}
.dokladR b{font-weight:800;color:var(--les);}
.dokladR em{font-style:italic;color:var(--okr);}
.origOdkaz{color:var(--salvej);font-weight:700;text-decoration:underline;text-underline-offset:2px;}
.origOdkaz:hover{color:var(--les);}

.nazevOdkaz{background:none;border:none;padding:0;font:inherit;font-size:13.5px;font-weight:650;color:var(--les);cursor:pointer;text-align:left;border-bottom:1px dotted var(--piskovec);}
.nazevOdkaz:hover{color:var(--okr);border-bottom-color:var(--okr);}
.radekPod{display:block;font-size:11.5px;color:var(--text2);margin-top:3px;}
.skupinaVyber{background:none;border:none;font:inherit;font-size:11.5px;color:var(--text2);cursor:pointer;padding:0;border-bottom:1px dotted var(--linka);}

.doklBar{display:flex;height:26px;border-radius:8px;overflow:hidden;background:var(--krem2);}
.doklBar i{display:block;height:100%;}
.tecka{display:inline-block;width:10px;height:10px;border-radius:3px;}

.dluhSouhrn{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;background:var(--krem);border-radius:12px;padding:14px 16px;margin-top:4px;}
.dluhSouhrn b{display:block;font-size:19px;font-weight:800;letter-spacing:-.025em;margin-top:2px;}

.zalohabox{border-left:5px solid var(--zluta);}
.ctaMaly{padding:7px 14px;font-size:12.5px;border-radius:8px;}
.zalohaNadpis{font-size:13.5px;font-weight:800;color:var(--les);margin:0 0 10px;}

.zalohapas{display:flex;align-items:flex-start;gap:12px;background:#FFF2D0;border-left:4px solid var(--zluta);border-radius:12px;padding:13px 15px;margin-top:14px;}
.zalohapas b{font-size:13.5px;color:var(--les);display:block;line-height:1.35;}
.zalohapas > div{flex:1;}
.zalohaR{display:block;font-size:12px;color:#8A6100;margin-top:4px;}
.zalohaR b{display:inline;font-weight:800;}

.tab[data-poz="1"]{background:var(--zluta);color:var(--les);}
.tab[data-poz="1"][data-a="1"]{background:var(--les);color:var(--zluta);}
`;
