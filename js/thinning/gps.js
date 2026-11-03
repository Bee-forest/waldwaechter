// Standortquelle für die Navigation: echtes GPS (Geolocation API) oder Simulation.
import { distance, bearing, destination } from '../geo.js';

export function createPositionSource({ simulate = false, start: simStart } = {}) {
  let watchId = null, timer = null, cb = () => {}, errCb = () => {};
  let simPos = simStart, walkTarget = null;

  const emit = () => simPos && cb({ latlng: simPos, accuracy: 4, heading: null, simulated: true, ts: Date.now() });

  return {
    simulated: simulate,
    start(onPos, onErr) {
      cb = onPos; errCb = onErr || errCb;
      if (simulate) {
        timer = setInterval(() => {
          if (walkTarget) {
            const d = distance(simPos, walkTarget);
            const step = 4; // m pro Sekunde (Zeitraffer)
            simPos = d <= step ? walkTarget : destination(simPos, bearing(simPos, walkTarget), step);
            if (d <= step) walkTarget = null;
          }
          emit();
        }, 1000);
        emit();
        return;
      }
      if (!('geolocation' in navigator)) { errCb({ code: 0, message: 'Dieses Gerät kann keinen Standort bestimmen.' }); return; }
      watchId = navigator.geolocation.watchPosition(
        (p) => cb({ latlng: [p.coords.latitude, p.coords.longitude], accuracy: p.coords.accuracy, heading: p.coords.heading, ts: p.timestamp }),
        (e) => errCb({
          code: e.code,
          message: e.code === 1
            ? 'Standortzugriff verweigert. Erlaube ihn in den Browser-Einstellungen für diese Seite.'
            : e.code === 3 ? 'GPS antwortet nicht. Unter dichtem Kronendach kann das dauern.' : 'Standort nicht verfügbar.',
        }),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
      );
    },
    stop() {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      clearInterval(timer);
      watchId = null; timer = null;
    },
    // nur Simulation
    setPosition(ll) { simPos = ll; walkTarget = null; emit(); },
    walkTo(ll) { walkTarget = ll; },
  };
}
