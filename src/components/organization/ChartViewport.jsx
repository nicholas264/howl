import React, {useRef, useState} from 'react';
export default function ChartViewport({children}) {
  const pan=useRef(null);
  const [panning,setPanning]=useState(false);
  const finish=e=>{
    if(pan.current?.pointerId!==e.pointerId)return;
    pan.current=null;setPanning(false);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return <div className={`org-tree ${panning?'org-panning':''}`} tabIndex={0}
    aria-label="Scrollable organization chart. Drag blank space to pan, or use arrow keys."
    onPointerDown={e=>{
      if(e.button!==0||!e.isPrimary||e.target.closest('.org-node,button,input,select,a'))return;
      const el=e.currentTarget;
      pan.current={pointerId:e.pointerId,x:e.clientX,y:e.clientY,left:el.scrollLeft,top:el.scrollTop};
      el.setPointerCapture(e.pointerId);el.focus({preventScroll:true});setPanning(true);e.preventDefault();
    }}
    onPointerMove={e=>{
      const p=pan.current;if(!p||p.pointerId!==e.pointerId)return;
      e.currentTarget.scrollLeft=p.left+p.x-e.clientX;
      e.currentTarget.scrollTop=p.top+p.y-e.clientY;
    }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
  >{children}</div>;
}
