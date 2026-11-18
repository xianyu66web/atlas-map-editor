'use strict';
let managedRoomSelection=null,roomClipboard=null;
function managedRoom(){return activeRoomDetail()||(managedRoomSelection?.mapId===mapId?backgroundRoomAt(managedRoomSelection.x,managedRoomSelection.y):null)}
function selectManagedRoom(x,y){managedRoomSelection=backgroundRoomAt(x,y);syncRoomOperations();draw()}
function roomContains(r,x,y){return x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h}
function roomOperationState(){const r=managedRoom();if(!r){toast('先在房间总览中单击选择房间');return null}return r}
function syncRoomOperations(){
 const enabled=!!world.roomSpec?.edit,r=managedRoom();$('roomOperations').hidden=!enabled;
 for(const id of ['roomInsert','roomCopy','roomDelete','roomRename','roomMirrorX','roomMirrorY'])$(id).disabled=!r;
 $('roomPaste').disabled=!r||!roomClipboard;
 if(r&&!activeRoomDetail())$('roomDetailLabel').textContent='已选 '+roomLabel(r)+' · 拖到另一房间可交换';
}
function finishRoomOperation(room,message){
 managedRoomSelection={...room};selected.clear();selectedRegion=null;activeGroup='';resetTerrainIndex();changed();syncRoomDetailUI();syncRoomOperations();draw();toast(message);
}
function regionPoints(r){
 if(Array.isArray(r.shape))return r.shape.map(xy);
 if(r.w*r.h>150000)throw Error('区域过大，请先缩小区域范围');
 const points=[];for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)points.push([x,y]);return points;
}
function checkedCell(x,y){if(!Number.isInteger(x)||!Number.isInteger(y)||Math.abs(x)>100000||Math.abs(y)>100000)throw Error('操作后超出地图坐标范围');return key(x,y)}
function transformRoomContents(mapPoint,room,message,options={}){
 try{
  const cells={},members={},tileArt={};
  for(const[k,type]of Object.entries(world.cells)){
   const target=mapPoint(...xy(k));if(!target)continue;const dest=checkedCell(...target);
   if(Object.hasOwn(cells,dest))throw Error('房间移动发生重叠');
   cells[dest]=type;if(world.members[k])members[dest]=world.members[k];if(options.art&&roomContains(room,...xy(k)))tileArt[dest]=options.art(world.tileArt[k]||{});else if(world.tileArt[k])tileArt[dest]={...world.tileArt[k]};
  }
  const regions=[];
  for(const r of world.regions){
   const original=regionPoints(r);let altered=false;const points=[];for(const[x,y]of original){const p=mapPoint(x,y);if(!p){altered=true;continue}if(p[0]!==x||p[1]!==y)altered=true;points.push(p)}
   if(!altered){regions.push(r);continue}
   const shape=points.map(p=>checkedCell(...p));if(shape.length)regions.push({...r,...bounds(shape),shape});
  }
  const removedCameras=new Set(),cameraRooms=[];
  for(const r of world.cameraRooms){const points=regionPoints(r).map(([x,y])=>mapPoint(x,y)).filter(Boolean);if(!points.length){removedCameras.add(r.id);continue}const keys=points.map(p=>checkedCell(...p));cameraRooms.push(options.camera?options.camera({...r,...bounds(keys)},r):{...r,...bounds(keys)})}
  for(const r of cameraRooms)r.exits=r.exits.filter(e=>!removedCameras.has(e.to));
  const roomNames=transformRoomNames(mapPoint);validate({...world,cells,members,tileArt,regions,cameraRooms,roomNames});checkpoint();Object.assign(world,{cells,members,tileArt,regions,cameraRooms,roomNames});finishRoomOperation(room,message);return true;
 }catch(error){toast(error.message);return false}
}
function swapRooms(source,target){
 if(source.mapId!==mapId||target.mapId!==mapId)return false;
 if(source.column===target.column&&source.row===target.row)return false;
 const dx=target.x-source.x,dy=target.y-source.y;
 return transformRoomContents((x,y)=>roomContains(source,x,y)?[x+dx,y+dy]:roomContains(target,x,y)?[x-dx,y-dy]:[x,y],target,'已交换两个房间，可撤销');
}
function insertRoom(side){
 const room=roomOperationState();if(!room)return;
 const vertical=side==='top'||side==='bottom',after=side==='right'||side==='bottom';
 const insertion={...room};
 if(vertical){insertion.y=room.y+(after?room.h:0);insertion.row=room.row+(after?1:0)}
 else{insertion.x=room.x+(after?room.w:0);insertion.column=room.column+(after?1:0)}
 const result=transformRoomContents((x,y)=>{
  if(vertical&&x>=room.x&&x<room.x+room.w&&y>=insertion.y)return[x,y+room.h];
  if(!vertical&&y>=room.y&&y<room.y+room.h&&x>=insertion.x)return[x+room.w,y];
  return[x,y];
 },insertion,'已插入空房间，后续房间顺移，可撤销');
 if(result&&activeRoomDetail()){roomDetail={...insertion};frameRoomDetail();syncRoomDetailUI()}
}
function deleteRoom(mode='clear'){
 const room=roomOperationState();if(!room)return;
 const result=transformRoomContents((x,y)=>{
  if(roomContains(room,x,y))return null;
  if(mode==='left'&&y>=room.y&&y<room.y+room.h&&x>=room.x+room.w)return[x-room.w,y];
  if(mode==='up'&&x>=room.x&&x<room.x+room.w&&y>=room.y+room.h)return[x,y-room.h];
  return[x,y];
 },room,mode==='clear'?'已清空房间，可撤销':'已删除房间并收拢后续房间，可撤销');
 return result;
}
function copyRoom(){
 const room=roomOperationState();if(!room)return;
 try{
  const cells=[],typeIds=new Set(),groupIds=new Set(),assetIds=new Set();
  for(const[k,type]of Object.entries(world.cells)){
   const[x,y]=xy(k);if(!roomContains(room,x,y))continue;
   const g=world.members[k],art=world.tileArt[k];cells.push({x:x-room.x,y:y-room.y,type,group:g,art:art?{...art}:null});typeIds.add(type);if(g)groupIds.add(g);if(art?.asset)assetIds.add(art.asset);
  }
  const regions=[];
  for(const r of world.regions){if(!regionsIntersect(r,room))continue;const shape=regionPoints(r).filter(([x,y])=>roomContains(room,x,y)).map(([x,y])=>key(x-room.x,y-room.y));if(shape.length)regions.push({...r,...bounds(shape),shape})}
  const cameraRooms=world.cameraRooms.filter(r=>r.x<room.x+room.w&&r.x+r.w>room.x&&r.y<room.y+room.h&&r.y+r.h>room.y).map(r=>{const x=Math.max(r.x,room.x),y=Math.max(r.y,room.y);return {...r,x:x-room.x,y:y-room.y,w:Math.min(r.x+r.w,room.x+room.w)-x,h:Math.min(r.y+r.h,room.y+room.h)-y,exits:clone(r.exits)}});
  roomClipboard={name:customRoomName(room),w:room.w,h:room.h,cells,regions,cameraRooms,types:clone(world.types.filter(t=>typeIds.has(t.id))),groups:clone(world.groups.filter(g=>groupIds.has(g.id))),assets:Object.fromEntries([...assetIds].map(id=>[id,world.artAssets[id]]))};
  syncRoomOperations();toast('已复制房间，可选择其他房间或切换场景后粘贴');return true;
 }catch(error){toast(error.message);return false}
}
function pasteRoom(){
 const room=roomOperationState(),clip=roomClipboard;if(!room||!clip)return;
 try{
  const fits=clip.cells.every(c=>c.x<room.w&&c.y<room.h)&&clip.regions.every(r=>r.x+r.w<=room.w&&r.y+r.h<=room.h)&&clip.cameraRooms.every(r=>r.x+r.w<=room.w&&r.y+r.h<=room.h);
  if(!fits)throw Error('复制内容超出目标房间，请调整目标房间尺寸');
  const occupied=!!customRoomName(room)||Object.keys(world.cells).some(k=>roomContains(room,...xy(k)))||world.regions.some(r=>regionsIntersect(r,room))||world.cameraRooms.some(r=>roomContains(room,r.x,r.y));
  if(occupied&&!$('overwrite').checked)throw Error('目标房间已有内容，请开启“允许覆盖已有方块”后粘贴');
  const types=clone(world.types),typeMap=new Map();
  for(const t of clip.types){let match=types.find(a=>a.name===t.name&&a.color===t.color&&a.image===t.image&&!!a.autoPattern===!!t.autoPattern&&a.solid===t.solid&&a.hazard===t.hazard);if(!match){match={...t,id:uid('tile')};types.push(match)}typeMap.set(t.id,match.id)}
  if(types.length>300)throw Error('粘贴后方块类型超过300种');
  const cells={},members={},tileArt={},assets={...world.artAssets},groups=clone(world.groups),groupMap=new Map(),assetMap=new Map();
  for(const[k,type]of Object.entries(world.cells))if(!roomContains(room,...xy(k))){cells[k]=type;if(world.members[k])members[k]=world.members[k];if(world.tileArt[k])tileArt[k]=world.tileArt[k]}
  for(const[id,image]of Object.entries(clip.assets)){const target=assets[id]&&assets[id]!==image?uid('art'):id;assets[target]=image;assetMap.set(id,target)}
  for(const c of clip.cells){
   const k=checkedCell(room.x+c.x,room.y+c.y);cells[k]=typeMap.get(c.type);
   if(c.group){if(!groupMap.has(c.group)){const id=uid('group');groupMap.set(c.group,id);groups.push({id,name:clip.groups.find(g=>g.id===c.group)?.name||'粘贴房间整体'})}members[k]=groupMap.get(c.group)}
   if(c.art){tileArt[k]={...c.art};if(c.art.asset)tileArt[k].asset=assetMap.get(c.art.asset)}
  }
  if(Object.keys(cells).length>150000)throw Error('粘贴后超过150000格');
  const regions=[];
  for(const r of world.regions){if(!regionsIntersect(r,room)){regions.push(r);continue}const shape=regionPoints(r).filter(([x,y])=>!roomContains(room,x,y)).map(p=>key(...p));if(shape.length)regions.push({...r,...bounds(shape),shape})}
  for(const r of clip.regions){const shape=r.shape.map(k=>{const[x,y]=xy(k);return checkedCell(x+room.x,y+room.y)});regions.push({...r,id:uid('region'),...bounds(shape),shape})}
  if(regions.length>2000)throw Error('粘贴后区域超过2000个');
  const cameraIds=new Map(clip.cameraRooms.map(r=>[r.id,uid('camera')]));
  const cameras=[];for(const r of world.cameraRooms){const points=regionPoints(r).filter(([x,y])=>!roomContains(room,x,y)).map(p=>checkedCell(...p));if(points.length)cameras.push({...r,...bounds(points)})}const retained=new Set(cameras.map(r=>r.id));
  const cameraRooms=cameras.map(r=>({...r,exits:r.exits.filter(e=>retained.has(e.to))}));
  for(const r of clip.cameraRooms)cameraRooms.push({...r,id:cameraIds.get(r.id),x:room.x+r.x,y:room.y+r.y,exits:r.exits.filter(e=>cameraIds.has(e.to)).map(e=>({...e,to:cameraIds.get(e.to)}))});
  if(cameraRooms.length>2000)throw Error('粘贴后镜头房间超过2000个');
  const roomNames={...world.roomNames},nameKey=key(room.column,room.row);delete roomNames[nameKey];if(clip.name)roomNames[nameKey]=clip.name;validate({...world,cells,members,tileArt,artAssets:assets,groups,types,regions,cameraRooms,roomNames});checkpoint();Object.assign(world,{cells,members,tileArt,artAssets:assets,groups,types,regions,cameraRooms,roomNames});finishRoomOperation(room,'已粘贴整个房间，可撤销');return true;
 }catch(error){toast(error.message);return false}
}
function drawRoomOperations(s){
 const r=managedRoom();if(!world.roomSpec.edit||!r||activeRoomDetail())return;
 ctx.save();ctx.strokeStyle='#f4d58a';ctx.lineWidth=2.5;ctx.strokeRect(r.x*s,r.y*s,r.w*s,r.h*s);
 if(gesture?.kind==='roomSwap'&&gesture.dragging){const target=gesture.target;ctx.fillStyle='#b8e3cc22';ctx.fillRect(target.x*s,target.y*s,target.w*s,target.h*s);ctx.strokeStyle='#b8e3cc';ctx.setLineDash([7,5]);ctx.strokeRect(target.x*s,target.y*s,target.w*s,target.h*s)}ctx.restore();
}
function initializeRoomOperations(){
 $('roomMirrorX').onclick=()=>mirrorRoom('horizontal');$('roomMirrorY').onclick=()=>mirrorRoom('vertical');
 $('roomRename').onclick=editManagedRoomName;$('saveGridRoomName').onclick=saveManagedRoomName;
 $('roomCopy').onclick=copyRoom;$('roomPaste').onclick=pasteRoom;
 $('roomInsert').onclick=()=>$('insertRoomDialog').showModal();
 $('roomDelete').onclick=()=>$('deleteRoomDialog').showModal();
 $('confirmRoomInsert').onclick=()=>{insertRoom($('insertRoomSide').value);$('insertRoomDialog').close()};
 $('confirmRoomDelete').onclick=()=>{deleteRoom($('deleteRoomMode').value);$('deleteRoomDialog').close()};
 window.addEventListener('keydown',e=>{
  if(!isRoomOverviewPicking()||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||document.querySelector('dialog[open]'))return;
  const k=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&['c','v'].includes(k)&&shortcutEnabled(k==='c'?'copy':'paste')){e.preventDefault();e.stopImmediatePropagation();if(k==='c')copyRoom();else pasteRoom()}
  if(['delete','backspace'].includes(k)&&shortcutEnabled('delete')&&managedRoom()){e.preventDefault();e.stopImmediatePropagation();$('deleteRoomDialog').showModal()}
 },{capture:true});syncRoomOperations();
}
function validateRoomNames(value){
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('房间名称无效');
 const names={};
 for(const[k,name]of Object.entries(value)){
  if(!/^-?\d+,-?\d+$/.test(k)||typeof name!=='string')throw Error('房间名称无效');
  const trimmed=name.trim().slice(0,40);if(trimmed)names[k]=trimmed;
 }
 return names;
}
function customRoomName(room){return world.roomNames?.[key(room.column,room.row)]||''}
function roomLabel(room){return customRoomName(room)||'房间 ['+room.column+', '+room.row+']'}
function editManagedRoomName(){
 const room=roomOperationState();if(!room)return;
 $('gridRoomName').value=customRoomName(room);$('gridRoomName').placeholder=roomLabel(room);
 $('roomNameDialog').showModal();$('gridRoomName').focus();
}
function saveManagedRoomName(){
 const room=roomOperationState();if(!room)return;
 const k=key(room.column,room.row),name=$('gridRoomName').value.trim().slice(0,40);
 checkpoint();world.roomNames={...world.roomNames};if(name)world.roomNames[k]=name;else delete world.roomNames[k];
 changed();syncRoomDetailUI();$('roomNameDialog').close();
}
function transformRoomNames(mapPoint){
 const spec=validateRoomSpec(world.roomSpec),names={};
 for(const[k,name]of Object.entries(world.roomNames||{})){
  const[column,row]=xy(k),p=mapPoint(spec.x+column*spec.w,spec.y+row*spec.h);if(!p)continue;
  names[key(Math.floor((p[0]-spec.x)/spec.w),Math.floor((p[1]-spec.y)/spec.h))]=name;
 }
 return names;
}

function mirrorRoom(axis){
 const room=roomOperationState();if(!room)return false;
 const horizontal=axis==='horizontal';
 for(const camera of world.cameraRooms){
  const overlaps=camera.x<room.x+room.w&&camera.x+camera.w>room.x&&camera.y<room.y+room.h&&camera.y+camera.h>room.y;
  if(overlaps&&!(roomContains(room,camera.x,camera.y)&&roomContains(room,camera.x+camera.w-1,camera.y+camera.h-1))){toast('镜头范围跨越此房间，请先调整范围');return false}
 }
 return transformRoomContents((x,y)=>roomContains(room,x,y)?horizontal?[room.x+room.w-1-(x-room.x),y]:[x,room.y+room.h-1-(y-room.y)]:[x,y],room,horizontal?'房间已水平镜像，可撤销':'房间已垂直镜像，可撤销',{
  art:a=>({...a,turns:((horizontal?0:2)-(a.turns||0)+4)%4,flipX:!a.flipX}),
  camera:(mapped,original)=>{
   if(!roomContains(room,original.x,original.y))return mapped;
   return {...mapped,exits:mapped.exits.map(e=>({...e,side:horizontal?e.side==='left'?'right':e.side==='right'?'left':e.side:e.side==='top'?'bottom':e.side==='bottom'?'top':e.side,offset:(horizontal?['top','bottom']:['left','right']).includes(e.side)?1-e.offset:e.offset}))};
  }
 });
}
