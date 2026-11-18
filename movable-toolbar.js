'use strict';
(function initializeMovableToolbar(){
 const toolbar=document.getElementById('tools'),handle=document.getElementById('toolDragHandle'),stage=document.getElementById('stage'),storageKey='atlas-toolbar-position-v1';
 let position=null;try{const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(Number.isFinite(saved?.x)&&Number.isFinite(saved?.y))position=saved}catch{}
 function persist(){try{if(position)localStorage.setItem(storageKey,JSON.stringify(position));else localStorage.removeItem(storageKey)}catch{}}
 function apply(){if(!position)return;const maxX=Math.max(0,stage.clientWidth-toolbar.offsetWidth),maxY=Math.max(0,stage.clientHeight-toolbar.offsetHeight);position.x=Math.max(0,Math.min(maxX,position.x));position.y=Math.max(0,Math.min(maxY,position.y));Object.assign(toolbar.style,{left:position.x+'px',top:position.y+'px',bottom:'auto',transform:'none'});}
 handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();handle.setPointerCapture(e.pointerId);const box=toolbar.getBoundingClientRect(),area=stage.getBoundingClientRect(),start={x:box.x-area.x,y:box.y-area.y},x=e.clientX,y=e.clientY;
  handle.onpointermove=e=>{position={x:start.x+e.clientX-x,y:start.y+e.clientY-y};apply()};
  const finish=()=>{handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;persist()};handle.onpointerup=finish;handle.onpointercancel=finish;
 };
 handle.ondblclick=()=>{position=null;for(const property of ['left','top','bottom','transform'])toolbar.style.removeProperty(property);persist()};
 handle.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const box=toolbar.getBoundingClientRect(),area=stage.getBoundingClientRect();position=position||{x:box.x-area.x,y:box.y-area.y};const step=e.shiftKey?20:5;position.x+=(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0);position.y+=(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0);apply();persist()};
 new ResizeObserver(()=>{apply();persist()}).observe(stage);apply();
})();
