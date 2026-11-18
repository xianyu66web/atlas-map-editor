'use strict';
(function initializeScenePicker(){
 const button=$('scenePickerButton'),menu=$('scenePickerMenu'),list=$('scenePickerList');
 let renderedSignature='';
 function close(){menu.hidden=true;button.setAttribute('aria-expanded','false')}
 function position(){const box=button.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(box.left,innerWidth-320))+'px';menu.style.top=box.bottom+5+'px';menu.style.maxHeight=Math.max(120,innerHeight-box.bottom-16)+'px'}
 window.refreshScenePicker=()=>{
  button.firstElementChild.textContent=world.title;const signature=JSON.stringify([mapId,maps.map(m=>[m.id,m.world.title])]);if(signature===renderedSignature)return;renderedSignature=signature;list.replaceChildren();
  for(const scene of maps){
   const row=document.createElement('div');row.className='scene-picker-row'+(scene.id===mapId?' current':'');
   const choose=document.createElement('button');choose.textContent=scene.world.title;choose.title=scene.world.title;choose.onclick=()=>{switchMap(scene.id);close()};
   const remove=document.createElement('button');remove.textContent='×';remove.className='scene-remove';remove.title='移入回收站';remove.setAttribute('aria-label','删除场景 '+scene.world.title);
   remove.onclick=()=>{const previous=mapId;if(scene.id!==mapId)switchMap(scene.id);deleteCurrentMap();if(maps.some(m=>m.id===scene.id)&&previous!==mapId)switchMap(previous);window.refreshScenePicker()};
   row.append(choose,remove);list.append(row);
  }
 };
 button.onclick=()=>{menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden){window.refreshScenePicker();position()}};
 $('sceneCreate').onclick=()=>{close();promptNewMap()};
 $('sceneTrash').onclick=()=>{close();showTrash().catch(storageFailure)};
 async function showTrash(){
  const target=$('sceneTrashList');target.replaceChildren();$('sceneTrashDialog').showModal();
  const records=await getSceneTrash();
  if(!records.length){target.textContent='回收站为空';return}
  for(const record of records){
   const row=document.createElement('div');row.className='trash-row';const name=document.createElement('span');name.textContent=record.world.title||'未命名场景';const restore=document.createElement('button');restore.textContent='恢复';
   restore.onclick=async()=>{restore.disabled=true;try{await restoreSceneFromTrash(record);$('sceneTrashDialog').close()}catch(error){storageFailure(error);restore.disabled=false}};
   row.append(name,restore);target.append(row);
  }
 }
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('.scene-picker'))close()});
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){e.preventDefault();e.stopImmediatePropagation();close();button.focus()}},{capture:true});
 window.addEventListener('resize',()=>{if(!menu.hidden)position()});
 window.refreshScenePicker();storageReady.then(()=>window.refreshScenePicker());
})();
