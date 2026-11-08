import { useState } from 'react';

// Start screen: the orange drops onto the pillow, then the screen fades into the app.
export default function Welcome({ onDone }) {
  const [entering, setEntering] = useState(false);
  const [leaving, setLeaving] = useState(false);

  function enter() {
    if (entering) return;
    setEntering(true);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      setLeaving(true);
      setTimeout(onDone, reduced ? 0 : 350);
    }, reduced ? 0 : 1400);
  }

  return (
    <div id="welcome" className={'start-screen' + (leaving ? ' leaving' : '')}>
      <div className="orb one" />
      <div className="orb two" />
      <div className="orb three" />
      <section className="start-center">
        <div className="logo-mark">
          <img src="/pillow.PNG" alt="Cushion pillow" />
          {entering && <img id="falling-orange" className="drop" src="/orangee.PNG" alt="" />}
        </div>
        <h1 className="brand-name">Cushion</h1>
        <p className="brand-caption">A little clarity. More peace of mind.</p>
        <button id="enter-app" type="button" className="search-user-btn" onClick={enter}>⌕ &nbsp; Search user database</button>
        <p id="welcome-status" role="status">{entering ? 'Opening your financial what-if lab…' : ''}</p>
      </section>
    </div>
  );
}
