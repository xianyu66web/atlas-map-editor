'use strict';
// Window layout is local to this browser, independent of scene content.
(function initializeFloatingPanels(){
 const layout=document.getElementById('layout'),storageKey='atlas-floating-panels-v1';
 let stored={};try{stored=JSON.parse(localStorage.getItem(storageKey)||'{}')||{}}catch{}
 const panels=[];let topZ=20;
 function persist(){try{localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(panels.map(p=>[p.side,p.state]))))}catch{}}
 function limits(p){
  const area=layout.getBoundingClientRect(),s=p.state;
  s.w=Math.max(Math.min(220,area.width),Math.min(s.w,area.width));
  s.h=Math.max(Math.min(180,area.height),Math.min(s.h,area.height));
  s.x=Math.max(0,Math.min(s.x,area.width-s.w));
  s.y=Math.max(0,Math.min(s.y,area.height-(s.collapsed?36:s.h)));
 }
 function apply(p){
  limits(p);const s=p.state;
  Object.assign(p.el.style,{left:s.x+'px',top:s.y+'px',width:s.w+'px',height:(s.collapsed?36:s.h)+'px'});
  p.el.classList.toggle('window-collapsed',s.collapsed);p.body.hidden=s.collapsed;p.grip.hidden=s.collapsed;
  p.toggle.textContent=s.collapsed?'＋':'−';p.toggle.setAttribute('aria-expanded',String(!s.collapsed));p.toggle.title=s.collapsed?'展开面板':'折叠为标题栏';
 }
 function toggle(p){p.state.collapsed=!p.state.collapsed;apply(p);persist()}
 for(const [side,title]of [['left','方块库 · 区域'],['right','房间 · 区域属性'],['settings','视图 · 编辑控制']]){
  const el=document.querySelector('aside.'+side),area=layout.getBoundingClientRect(),saved=stored[side]||{};
  function defaults(){const area=layout.getBoundingClientRect();return {x:side==='left'?12:Math.max(0,area.width-(side==='settings'?584:292)),y:12,w:280,h:side==='settings'?Math.min(620,Math.max(180,area.height-105)):Math.max(180,area.height-105),collapsed:false}}
  const state=defaults();
  for(const k of ['x','y','w','h'])if(Number.isFinite(saved[k]))state[k]=saved[k];state.collapsed=saved.collapsed===true;
  const body=document.createElement('div');body.className='window-body';while(el.firstChild)body.append(el.firstChild);
  const head=document.createElement('div');head.className='window-title';head.tabIndex=0;head.title='拖动移动面板，双击折叠或展开';head.setAttribute('aria-label',title+'：拖动移动，方向键微调');
  const label=document.createElement('b');label.textContent=title;
  const reset=document.createElement('button');reset.textContent='↺';reset.title='恢复面板默认位置和大小';reset.setAttribute('aria-label','恢复'+side+'面板布局');
  const button=document.createElement('button');button.setAttribute('aria-label','折叠或展开'+title);
  head.append(label,reset,button);
  const grip=document.createElement('div');grip.className='window-resize';grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-label','调整'+title+'大小');grip.title='拖动调整宽高，方向键微调';
  el.append(head,body,grip);el.classList.remove('collapsed','visible');el.classList.add('floating-panel');
  const p={el,side,state,body,head,toggle:button,grip};panels.push(p);apply(p);
  el.addEventListener('pointerdown',()=>el.style.zIndex=++topZ);
  button.onclick=()=>toggle(p);head.ondblclick=e=>{if(!e.target.closest('button')&&shortcutEnabled('panelCollapse'))toggle(p)};
  reset.onclick=()=>{Object.assign(state,defaults());apply(p);persist()};
  function drag(handle,resizing){
   handle.onpointerdown=e=>{
    if(e.button!==0||e.target.closest('button'))return;e.preventDefault();handle.setPointerCapture(e.pointerId);
    const start={...state},x=e.clientX,y=e.clientY;
    handle.onpointermove=e=>{if(resizing){state.w=start.w+e.clientX-x;state.h=start.h+e.clientY-y}else{state.x=start.x+e.clientX-x;state.y=start.y+e.clientY-y}apply(p)};
    const finish=()=>{handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;persist()};handle.onpointerup=finish;handle.onpointercancel=finish;
   };
   handle.onkeydown=e=>{if(e.target!==handle)return;const step=e.shiftKey?20:5;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){if(!shortcutEnabled(resizing?'panelResize':'panelMove'))return;e.preventDefault();e.stopPropagation();const horizontal=['ArrowLeft','ArrowRight'].includes(e.key),delta=['ArrowLeft','ArrowUp'].includes(e.key)?-step:step;state[resizing?(horizontal?'w':'h'):(horizontal?'x':'y')]+=delta;apply(p);persist()}else if(!resizing&&['Enter',' '].includes(e.key)){if(!shortcutEnabled('panelCollapse'))return;e.preventDefault();toggle(p)}};
  }
  drag(head,false);drag(grip,true);
 }
 window.addEventListener('resize',()=>{for(const p of panels)apply(p);persist()});
 // All panel movement leaves the canvas size and scene coordinates unchanged.
 resize();
})();
