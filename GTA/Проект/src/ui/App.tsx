import { useEffect, useRef, useState } from 'react';
import { Simulation } from '../game/simulation';
import { Input } from '../game/input';
import { MouseLook } from '../game/mouse';
import { GameAudio } from '../game/audio';
import { GameRenderer } from '../render/GameRenderer';
import type { GameState, MissionPhase, WeaponId, World } from '../game/types';
import { WEAPON_SPECS } from '../game/combat';
import { VEHICLE_SPECS } from '../game/vehicles';
import { policeEscapeDuration } from '../game/policePursuit';
import { Icon } from './icons';
import { TouchControls } from './TouchControls';
import { Minimap } from './Minimap';

interface View { state: GameState; world: World; hint: string }
interface Commands { play(): void; pause(): void; help(): void; sound(): void; restart(): void; camera(): void; map(): void; interact(): void }
const OBJECTIVES: Record<MissionPhase, [string, string]> = {
  available: ['Your first run.', 'Meet at Portside Dispatch to pick up a local delivery.'],
  collect: ['Your ride is ready.', 'Get into the marked yellow coupe. The parcel is already on board.'],
  deliver: ['Take the scenic route.', 'Deliver the coupe to North Quay. Stop inside the marker with the coast clear.'],
  success: ['Nicely delivered.', 'One happy customer. The rest of the city is yours to explore.'],
  failed: ['A little detour.', 'The police stopped your delivery. Take a breath and try the run again.'],
};
const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const WEAPONS: WeaponId[] = ['knife', 'pistol', 'rifle'];

function WeaponGlyph({ weapon }: { weapon: WeaponId }) {
  return <svg viewBox="0 0 48 28" aria-hidden="true" className="weapon-glyph" fill="currentColor">
    {weapon === 'knife' ? <><path d="M18 16 39 3c-1 9-8 15-17 17Z"/><path d="m8 23 9-8 6 6-3 3-3-2-6 5Z"/><path d="m16 12 12 11-2 2-12-11Z"/></>
      : weapon === 'pistol' ? <><path d="M8 7h32v7H25l-4 13h-9l3-14H8Z"/><path d="M25 13h9v7h-11l1-3h7v-2h-7Z"/><path d="M12 5h3v3h-3m23-3h3v3h-3"/></>
        : <><path d="M3 10h10l4-3h19v4h10v3H31l-4 4H15l-5-3-7 3Z"/><path d="m17 16 6 1-2 10h-5zm9 0h6l2 9-6 1Z"/><path d="M22 4h8v4h-8m-9 13h3v3h-3"/></>}
  </svg>;
}

export function App() {
  const [touchMode] = useState(() => navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches);
  const touchInput = useRef<Input | null>(null);
  const touchLook = useRef<(dx: number, dy: number) => void>(() => {});
  const host = useRef<HTMLDivElement>(null);
  const commands = useRef<Commands | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [paused, setPaused] = useState(true);
  const [started, setStarted] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [help, setHelp] = useState(false);
  const [sound, setSound] = useState(false);
  const [expandedMap, setExpandedMap] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!host.current) return;
    const viewport = host.current;
    const simulation = new Simulation();
    let renderer: GameRenderer;
    try { renderer = new GameRenderer(host.current, simulation.world, simulation.state); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); return; }
    const audio = new GameAudio();
    const resizeObserver = new ResizeObserver(() => renderer.resize());
    resizeObserver.observe(host.current);
    let isPaused = true;
    let isHelp = false;
    let noticeUntil = 0;
    let disposed = false;
    const notify = (message: string) => { setNotice(message); noticeUntil = performance.now() + 2600; };
    const focus = () => { (document.activeElement as HTMLElement)?.blur?.(); host.current?.focus({ preventScroll: true }); };
    const input = new Input(code => {
      // Escape is also the browser's unlock gesture; never recapture on that same key.
      if (code === 'Escape' && !isPaused) pauseGame();
      if (code === 'KeyP') commands.current?.pause();
      if (code === 'KeyH') commands.current?.help();
      if (code === 'KeyM') commands.current?.sound();
      if (code === 'KeyC') commands.current?.camera();
      if (code === 'KeyN') commands.current?.map();
    }, viewport);
    touchInput.current = input;
    touchLook.current = (dx, dy) => { if (!isPaused && !isHelp) renderer.look(dx, dy); };
    const mouse = new MouseLook(viewport, {
      onLook: (dx, dy) => { if (!isPaused && !isHelp) renderer.look(dx, dy); },
      onLockChange: locked => {
        if (disposed) return;
        input.clear();
        isPaused = !locked;
        setPaused(!locked);
        if (locked) {
          isHelp = false; setHelp(false); setStarted(true); setCaptureError(''); focus();
        }
      },
      onError: message => {
        if (disposed) return;
        pauseGame();
        setCaptureError(message);
      },
    });
    const pauseGame = () => {
      isPaused = true; setPaused(true); input.clear(); mouse.release();
    };
    const play = () => {
      isHelp = false; setHelp(false); setCaptureError(''); input.clear();
      // Request within the click/key gesture; only a successful lock resumes play.
      if (touchMode) { isPaused = false; setPaused(false); setStarted(true); focus(); }
      else mouse.request();
    };
    commands.current = {
      play,
      pause: () => { if (isPaused) play(); else pauseGame(); },
      help: () => {
        if (isHelp) play();
        else { isHelp = true; setHelp(true); pauseGame(); }
      },
      sound: () => { void audio.toggle().then(value => { if (!disposed) setSound(value); }).catch(() => notify('Audio is unavailable in this browser.')); focus(); },
      restart: () => { simulation.restartMission(); input.clear(); if (isPaused) play(); },
      camera: () => { notify(renderer.cycleCamera()); focus(); },
      map: () => { setExpandedMap(value => !value); focus(); },
      interact: () => { if (!isPaused) simulation.interact(); focus(); },
    };
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;
    let lastUI = 0;
    const updateUI = () => {
      setView({ state: { ...simulation.state }, world: simulation.world, hint: simulation.getHint() });
      if (import.meta.env.DEV && host.current) {
        const position = simulation.getControlled();
        host.current.dataset.telemetry = JSON.stringify({ time: simulation.state.time, x: position.x, z: position.z, mode: simulation.state.player.vehicleId ?? 'foot', collisions: simulation.state.collisions, phase: simulation.state.mission.phase });
      }
    };
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      if (!isPaused && !document.hidden && (touchMode || document.pointerLockElement === viewport)) {
        accumulator = Math.min(accumulator + dt, 5 / 60);
        while (accumulator >= 1 / 60) {
          const controls = input.sample();
          renderer.prepareAim(simulation.state, controls);
          simulation.step(1 / 60, { ...controls, viewYaw: renderer.getMovementYaw(), aimRay: renderer.getAimRay() });
          accumulator -= 1 / 60;
        }
      } else { accumulator = 0; input.clear(); }
      renderer.update(simulation.state, isPaused ? 0 : dt);
      audio.update(simulation.state, isPaused || document.hidden);
      if (now - lastUI > 90) { updateUI(); lastUI = now; }
      if (noticeUntil && now > noticeUntil) { setNotice(''); noticeUntil = 0; }
      frame = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      input.clear(); previous = performance.now(); accumulator = 0;
      if (document.hidden) pauseGame();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', pauseGame);
    updateUI();
    frame = requestAnimationFrame(tick);
    // Read-only development telemetry supports reproducible playtest diagnostics.
    if (import.meta.env.DEV) {
      Object.assign(window, { __PORTSIDE__: {
        snapshot: () => structuredClone(simulation.state), world: () => structuredClone(simulation.world),
        camera: () => ({ yaw: renderer.getMovementYaw(), position: renderer.camera.position.toArray(), direction: renderer.camera.getWorldDirection(renderer.camera.position.clone()).toArray() }),
        controls: () => ({ paused: isPaused, mouseLocked: document.pointerLockElement === viewport }),
      } });
    }
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', pauseGame);
      touchInput.current = null; touchLook.current = () => {};
      mouse.dispose(); input.dispose(); audio.dispose(); renderer.dispose(); commands.current = null;
      delete (window as Window & { __PORTSIDE__?: unknown }).__PORTSIDE__;
    };
  }, [touchMode]);

  const state = view?.state;
  const controlled = state?.vehicles.find(v => v.id === state.player.vehicleId);
  const location = controlled ?? state?.player;
  const phase = state?.mission.phase ?? 'available';
  const objective = OBJECTIVES[phase];
  const target = view && (phase === 'deliver' ? view.world.destination : phase === 'collect' ? state!.vehicles.find(v => v.kind === 'mission')! : view.world.pickup);
  const distance = location && target ? Math.round(Math.hypot(location.x - target.x, location.z - target.z)) : 0;
  const wanted = state?.police.wanted ?? 0;
  const searching = wanted > 0 && !state?.police.spotted;
  const respondingPatrols = state?.vehicles.filter(car => car.kind === 'police' && car.active &&
    !state.officers.some(officer => officer.vehicleId === car.id && officer.state === 'dead')).length ?? 0;
  const escapeProgress = wanted > 0 ? Math.max(0, Math.min(100, (state?.police.escape ?? 0) / policeEscapeDuration(wanted) * 100)) : 0;
  const policeHint = searching ? 'Stay out of sight.' : state?.police.caught ? 'Keep moving.'
    : controlled ? 'Units moving to intercept.' : wanted >= 3 ? 'Armed response. Find cover.' : 'Break line of sight.';
  const combat = state?.combat;
  const weapon = combat?.weapon ?? 'knife';
  const ammunition = combat && weapon !== 'knife' ? combat.ammo[weapon] : null;
  const reload = combat?.reload;
  const reloadProgress = reload ? Math.max(0, Math.min(100, (1 - reload.remaining / reload.duration) * 100)) : 0;
  const damageOpacity = combat && state && !combat.dead ? Math.max(0, 1 - (state.time - combat.lastDamageAt) / .65) * .85 : 0;
  const district = !location ? 'Central District'
    : location.z < -142 ? 'Northside' : location.z > 142 ? 'Southbank'
    : location.x < -142 ? 'West End' : location.x > 142 ? 'East Harbor'
    : location.z < -45 ? 'North Quay' : location.x < -45 ? 'Old Town' : location.x > 45 ? 'Palm Quarter' : 'Central District';
  const activeStep = phase === 'available' ? 0 : phase === 'collect' ? 1 : phase === 'deliver' ? 2 : phase === 'success' ? 3 : 2;
  const finished = phase === 'success' || phase === 'failed';
  const hint = view?.hint ?? '';
  const canInteract = /^E\s*[·:—–-]/.test(hint);
  const hintKey = canInteract ? 'E' : hint.startsWith('SPACE') ? 'SPACE' : '';
  const hintText = hint.replace(/^(E|SPACE)\s*[·:—–-]\s*/, '');

  return <main className={`game ${touchMode ? 'touch-mode' : ''} ${wanted ? 'is-wanted' : ''} ${!paused ? 'is-playing' : ''} ${expandedMap ? 'map-expanded' : ''} ${controlled ? 'is-driving' : ''}`}>
    <div className="world-viewport" ref={host} tabIndex={-1} aria-label={touchMode ? "Portside 3D game. Left stick to move, swipe to look, touch buttons to attack, aim, interact and equip weapons." : "Portside 3D game. Mouse to look, WASD to move, 1/2/3 to equip, left mouse to attack, right mouse to aim, R to reload, E to interact, Escape to pause."} />
    <div className="screen-shade" />
    <div className="damage-vignette" style={{ opacity: damageOpacity }} aria-hidden="true"/>
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><span/><span/><span/></div><div><h1>PORTSIDE<span>®</span></h1><p>A LITTLE OPEN WORLD</p></div></div>
      <div className="place"><Icon name="pin" size={15}/><span>{district}</span><span className="place-divider"/><Icon name="sun" size={17}/><span>16:42</span></div>
      <nav className="toolbar" aria-label="Game settings">
        <span className="live-session"><i className="live-dot"/> FREE ROAM</span>
        <button className={`icon-button ${sound ? 'selected' : ''}`} onClick={() => commands.current?.sound()} aria-label={sound ? 'Mute sound (M)' : 'Enable sound (M)'} title="Toggle sound · M"><Icon name={sound ? 'sound' : 'mute'}/></button>
        <button className="icon-button" onClick={() => commands.current?.pause()} aria-label={paused ? 'Resume game' : 'Pause game'} title="Pause · Esc"><Icon name={paused ? 'play' : 'pause'}/></button>
        <button className="icon-button help-button" onClick={() => commands.current?.help()} aria-label="Show controls and help" title="Controls · H"><Icon name="help"/></button>
      </nav>
    </header>

    {view && <>
      <aside className={`mission panel ${phase === 'success' ? 'mission-complete' : ''}`} aria-label="Current mission">
        <div className="eyebrow"><span className="mission-symbol"><Icon name={phase === 'success' ? 'check' : 'box'} size={16}/></span><span>{phase === 'success' ? 'DELIVERY COMPLETE' : 'LOCAL DELIVERY'}</span><span className="mission-number">01</span></div>
        <h2>{objective[0]}</h2><p className="mission-description">{objective[1]}</p>
        <div className="mission-steps">
          {['Meet at the dispatch', 'Pick up the yellow coupe', 'Deliver to North Quay'].map((label, index) => <div key={label} className={`mission-step ${index === activeStep ? 'current' : ''} ${index < activeStep ? 'done' : ''}`}><span className="step-number">{index < activeStep ? <Icon name="check" size={11}/> : `0${index + 1}`}</span><span>{label}</span>{index === activeStep && <Icon name="arrow" size={14}/>}</div>)}
        </div>
        <div className="mission-footer"><span><Icon name={finished ? 'flag' : 'pin'} size={13}/>{finished ? phase === 'success' ? 'PARCEL DELIVERED' : 'DELIVERY INTERRUPTED' : phase === 'available' ? 'PORTSIDE DISPATCH' : phase === 'collect' ? 'YOUR COURIER COUPE' : 'NORTH QUAY'}</span><strong>{finished ? formatTime(state!.mission.elapsed) : `${distance} m`}</strong></div>
        {finished && <button className="replay-button" onClick={() => commands.current?.restart()}><Icon name="restart" size={14}/> {phase === 'success' ? 'Make another run' : 'Try delivery again'} <kbd>T</kbd></button>}
      </aside>

      <div className={`police-status panel ${wanted ? 'alert' : ''}`} role="status">
        <Icon name="shield" size={17}/><div><span>{wanted ? searching ? 'POLICE SEARCH' : wanted >= 3 ? 'ARMED POLICE PURSUIT' : 'POLICE PURSUIT' : 'THE COAST IS CLEAR'}</span>{wanted > 0 && <small>{respondingPatrols} {respondingPatrols === 1 ? 'patrol' : 'patrols'} · {policeHint}</small>}</div><div className="wanted-stars" aria-label={`${wanted} of 3 wanted stars`}>{[1, 2, 3].map(n => <span key={n} className={n <= wanted ? 'lit' : ''}>★</span>)}</div>
        {wanted > 0 && <div className="escape-progress" role="progressbar" aria-label="Lose the police" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(escapeProgress)} style={{ width: `${escapeProgress}%` }}/>}
      </div>

      {combat && <aside className={`weapon-panel panel ${controlled ? 'holstered' : ''}`} aria-label="Weapons and ammunition">
        <div className="weapon-slots">{WEAPONS.map((id, index) => <span key={id} className={`weapon-slot ${weapon === id ? 'active' : ''}`} aria-label={`${index + 1}: ${WEAPON_SPECS[id].label}${weapon === id ? ', equipped' : ''}`}><kbd>{index + 1}</kbd><WeaponGlyph weapon={id}/></span>)}</div>
        <div className="weapon-heading"><strong>{WEAPON_SPECS[weapon].label}</strong><span>{controlled ? 'HOLSTERED' : weapon === 'knife' ? 'MELEE' : WEAPON_SPECS[weapon].automatic ? 'AUTO' : 'SEMI-AUTO'}</span></div>
        <div className={`ammo-display ${ammunition?.magazine === 0 ? 'empty' : ''}`}>
          {ammunition ? <><strong>{ammunition.magazine.toString().padStart(2, '0')}</strong><span>/ {ammunition.reserve}</span><small>ROUNDS</small></> : <><strong className="melee-ready">READY</strong><small>CLOSE RANGE</small></>}
        </div>
        <div className={`weapon-action ${reload ? 'reloading' : ''}`}>
          {controlled ? <span>Exit the vehicle to use weapons</span> : reload ? <><span>RELOADING</span><b>{Math.max(0, reload.remaining).toFixed(1)}s</b></> : weapon === 'knife' ? <span><kbd>LMB</kbd> Strike</span> : <><span><kbd>R</kbd> {ammunition?.magazine === 0 && ammunition.reserve === 0 ? 'No ammunition' : 'Reload'}</span><span><kbd>RMB</kbd> Aim</span></>}
        </div>
        {reload && <div className="reload-meter" role="progressbar" aria-label="Reload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(reloadProgress)}><i style={{ width: `${reloadProgress}%` }}/></div>}
      </aside>}

      {combat && !paused && !controlled && !combat.dead && <div className={`crosshair ${weapon === 'knife' ? 'melee' : ''} ${combat.aiming ? 'aiming' : ''} ${state!.time - combat.lastAttackAt < .12 ? 'firing' : ''}`} aria-hidden="true"><i/><i/><i/><i/><span className="crosshair-dot"/>{combat.hitUntil > state!.time && <span className={`hit-marker ${combat.killUntil > state!.time ? 'kill' : ''}`}/>}</div>}

      <div className="district-caption"><span>WELCOME TO</span><strong>{district}</strong><span className="district-rule"/></div>

      <div className="bottom-left">
        <section className="player-panel panel" aria-label="Player status">
          <div className="player-mode"><span className="mode-icon"><Icon name={controlled ? 'car' : 'person'} size={23}/></span><div><span className="eyebrow small">{controlled ? controlled.kind === 'mission' ? 'COURIER COUPE' : VEHICLE_SPECS[controlled.model].label.toUpperCase() : 'MAKE YOUR OWN WAY'}</span><strong>{controlled ? 'DRIVING' : 'ON FOOT'}</strong></div><i className="live-dot"/></div>
          {controlled && <div className="speedometer"><strong>{Math.round(Math.abs(controlled.speed) * 3.6).toString().padStart(2, '0')}</strong><span>KM/H</span><div className="speed-bars">{Array.from({ length: 14 }, (_, n) => <i key={n} className={n < Math.abs(controlled.speed) / 2 ? 'filled' : ''}/>)}</div><b>{controlled.speed < -0.3 ? 'R' : Math.abs(controlled.speed) < 0.2 ? 'N' : 'D'}</b></div>}
          {combat && <div className={`health-status ${combat.health <= 30 ? 'critical' : ''}`}><div><span>HEALTH</span><strong>{Math.ceil(Math.max(0, combat.health))}<small> / 100</small></strong></div><div className="health-meter" role="progressbar" aria-label="Health" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.ceil(Math.max(0, combat.health))}><i style={{ width: `${Math.max(0, combat.health)}%` }}/></div></div>}
        </section>
        <div className="session-caption"><span className="session-line"/> NO RUSH. JUST EXPLORE.</div>
      </div>

      <div className="map-area"><div className="map-location"><Icon name="compass" size={16}/><span>{district}</span><span>{Math.round(location!.x)}, {Math.round(location!.z)}</span></div><Minimap world={view.world} state={state!} expanded={expandedMap} onToggle={() => setExpandedMap(v => !v)}/></div>

      <div className="interaction-area" aria-live="polite">
        {(notice || (state!.messageUntil > state!.time && state!.message)) && <div className="toast panel">{notice || state!.message}</div>}
        {hint && !paused && (canInteract ? <button className="interaction panel" onClick={() => commands.current?.interact()}><kbd>E</kbd><span>{hintText}</span><Icon name="arrow" size={17}/></button> : <div className="interaction panel">{hintKey && <kbd>{hintKey}</kbd>}<span>{hintText}</span></div>)}
      </div>

      <footer className="controls-bar"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {controlled ? 'Drive' : 'Move'}</span><span className="secondary-control"><kbd>MOUSE</kbd> Look</span>{!controlled && <span><kbd>LMB</kbd> {weapon === 'knife' ? 'Strike' : 'Fire'}</span>}<span><kbd>E</kbd> {controlled ? 'Exit car' : 'Interact'}</span><span className="secondary-control"><kbd>{controlled ? 'SPACE' : 'SHIFT'}</kbd> {controlled ? 'Brake' : 'Run'}</span><span className="secondary-control"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Equip</span><span className="secondary-control"><kbd>ESC</kbd> Pause</span><button onClick={() => commands.current?.help()}><kbd>H</kbd> Controls</button></footer>
      {combat?.dead && <div className="death-overlay" role="status"><span>PORTSIDE EMERGENCY SERVICES</span><strong>WASTED</strong><p>Back on your feet in <b>{Math.ceil(Math.max(0, combat.respawnIn))}</b>s</p></div>}
    </>}

    {touchMode && view && !paused && <TouchControls input={touchInput.current!} driving={!!controlled}
      onLook={(dx, dy) => touchLook.current(dx, dy)} onCamera={() => commands.current?.camera()}
      onRestart={() => commands.current?.restart()} />}
    {!view && !error && <div className="loading"><div className="loader"/><span>Opening up the neighborhood…</span></div>}
    {error && <div className="modal-backdrop"><section className="dialog"><h2>The city couldn't load.</h2><p>Portside needs a browser with WebGL 2 and hardware acceleration enabled.</p><code>{error}</code><button className="primary-button" onClick={() => window.location.reload()}>Try again</button></section></div>}
    {paused && view && !error && <div className="modal-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      {started && <button className="dialog-close icon-button" onClick={() => commands.current?.play()} aria-label="Close and resume"><Icon name="close"/></button>}
      <div className="eyebrow"><Icon name="compass" size={18}/><span>A LITTLE ROOM TO ROAM</span></div>
      <h2 id="dialog-title">{help ? 'Know your way around.' : started ? 'Take a breather.' : 'Step into Portside.'}</h2>
      <p>{help ? 'Walk the neighborhood, borrow a car, or make your first delivery.' : started ? 'The city can wait. Your delivery and the simulation are paused.' : touchMode ? 'Use the left stick to move, swipe the open screen to look, and hold the action buttons. Landscape gives you more room.' : 'A little city to explore. Move the mouse to look around, and use WASD to walk in the direction of the camera.'}</p>
      {touchMode && <p>Left stick: walk / drive. Swipe: look. Hold Fire, Aim or Run / Brake. Use E to interact or enter a car. 1 / 2 / 3 select weapons; R reloads.</p>}
      {help && !touchMode && <><div className="help-controls">{[['Mouse', 'Look around on foot or in a car'], ['W / S', 'Walk forward / back · throttle / reverse'], ['A / D', 'Step left / right · steer a car'], ['1 / 2 / 3', 'Knife / pistol / assault rifle'], ['Left mouse', 'Strike / fire · hold for automatic fire'], ['Right mouse', 'Hold to aim a firearm'], ['R', 'Reload the equipped firearm'], ['E', 'Start delivery / enter / exit car'], ['Shift / Space', 'Run on foot / brake in a car'], ['C', 'Switch camera distance'], ['N', 'Expand / collapse city map'], ['T', 'Restart the courier mission'], ['M', 'Toggle synthesized sound'], ['Esc', 'Pause and release the mouse'], ['P', 'Pause / resume']].map(([key, label]) => <div key={key}><kbd>{key}</kbd><span>{label}</span></div>)}</div><div className="help-tip"><Icon name="shield" size={18}/><p>Killing a pedestrian triggers three stars and armed patrols, with reinforcements up to six cars. Break line of sight and leave the search area. Stay unseen for {policeEscapeDuration(1)} seconds at one star or {policeEscapeDuration(3)} seconds at three stars. Being spotted restarts the search timer.</p></div></>}
      <p className="mouse-instructions">{touchMode ? "Tap Play to start. Use the pause button to open the menu." : <>Click to play with the cursor hidden. Press <kbd>ESC</kbd> to pause and use the menus.</>}</p>
      {captureError && <p className="capture-error" role="alert">{captureError}</p>}
      <button className="primary-button" onClick={() => commands.current?.play()}><Icon name="play" size={17}/> {started ? 'Back to the city' : 'Play'} <span>CLICK TO PLAY</span></button>
    </section></div>}
  </main>;
}
