import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Input } from '../game/input';

interface Props { input: Input; driving: boolean; onLook(dx: number, dy: number): void; onCamera(): void; onRestart(): void }

function HoldButton({ input, code, children }: { input: Input; code: string; children: string }) {
  const pointers = useRef(new Set<number>());
  const [held, setHeld] = useState(false);
  const release = (event: PointerEvent<HTMLButtonElement>) => {
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) { input.releaseTouch(code); setHeld(false); }
  };
  useEffect(() => () => { input.releaseTouch(code); }, [input, code]);
  return <button type="button" className={held ? 'held' : ''} aria-label={children} onPointerDown={event => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.add(event.pointerId); input.pressTouch(code); setHeld(true);
  }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>{children}</button>;
}

export function TouchControls({ input, driving, onLook, onCamera, onRestart }: Props) {
  const stick = useRef<number | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => () => input.clear(), [input]);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (stick.current !== event.pointerId) return;
    const box = event.currentTarget.getBoundingClientRect();
    const radius = box.width / 2 - 24;
    const dx = event.clientX - box.left - box.width / 2;
    const dy = event.clientY - box.top - box.height / 2;
    const distance = Math.hypot(dx, dy);
    const scale = distance > radius ? radius / distance : 1;
    const x = dx * scale, y = dy * scale;
    setOffset({ x, y });
    input.moveTouch(distance < 9 ? 0 : -y / radius, distance < 9 ? 0 : x / radius);
  };
  const releaseStick = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== stick.current) return;
    stick.current = null; input.moveTouch(0, 0); setOffset({ x: 0, y: 0 });
  };
  const releaseLook = (event: PointerEvent<HTMLDivElement>) => {
    if (look.current?.id === event.pointerId) look.current = null;
  };
  return <div className="touch-controls" onContextMenu={event => event.preventDefault()}>
    <div className="touch-look" aria-label="Swipe to look around" onPointerDown={event => {
      if (look.current) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      look.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }} onPointerMove={event => {
      const previous = look.current;
      if (previous?.id !== event.pointerId) return;
      onLook((event.clientX - previous.x) * 2, (event.clientY - previous.y) * 2);
      look.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }} onPointerUp={releaseLook} onPointerCancel={releaseLook} onLostPointerCapture={releaseLook}/>
    <div className="touch-stick" aria-label={driving ? 'Steering and throttle joystick' : 'Movement joystick'} onPointerDown={event => {
      if (stick.current !== null) return;
      event.preventDefault(); stick.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); move(event);
    }} onPointerMove={move} onPointerUp={releaseStick} onPointerCancel={releaseStick} onLostPointerCapture={releaseStick}>
      <span className="stick-label">{driving ? 'DRIVE' : 'MOVE'}</span><i style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}/>
    </div>
    <div className="touch-actions">
      {!driving && <><HoldButton input={input} code="Aim">Aim</HoldButton><HoldButton input={input} code="Fire">Fire</HoldButton></>}
      <HoldButton input={input} code={driving ? 'Space' : 'ShiftLeft'}>{driving ? 'Brake' : 'Run'}</HoldButton>
      <HoldButton input={input} code="KeyE">E · Use / Car</HoldButton>
      {!driving && <HoldButton input={input} code="KeyR">R · Reload</HoldButton>}
    </div>
    <div className="touch-tools">
      {!driving && ['1', '2', '3'].map(key => <HoldButton key={key} input={input} code={`Digit${key}`}>{key}</HoldButton>)}
      <button onClick={onCamera} aria-label="Change camera">Camera</button><button onClick={onRestart}>Restart</button>
    </div>
  </div>;
}
