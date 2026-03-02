import { useEffect, useRef, useState } from "react";

export function useBoostTrail() {
  const [boostTrailEnabled, setBoostTrailEnabled] = useState(false);
  const [boostTrail, setBoostTrail] = useState([]);
  const [boostFuel, setBoostFuel] = useState(100);
  const [boostPads, setBoostPads] = useState([]);

  const trailIdRef = useRef(0);
  const lastPointRef = useRef(null);
  const boostFuelRef = useRef(100);
  const boostPadsRef = useRef([]);
  const audioCtxRef = useRef(null);

  function playBoostPickupSound(isBigPickup) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(isBigPickup ? 0.13 : 0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (isBigPickup ? 0.26 : 0.18));
      gain.connect(ctx.destination);

      const oscA = ctx.createOscillator();
      oscA.type = "triangle";
      oscA.frequency.setValueAtTime(isBigPickup ? 520 : 460, now);
      oscA.frequency.exponentialRampToValueAtTime(isBigPickup ? 1160 : 920, now + (isBigPickup ? 0.24 : 0.16));
      oscA.connect(gain);
      oscA.start(now);
      oscA.stop(now + (isBigPickup ? 0.26 : 0.18));

      const oscB = ctx.createOscillator();
      oscB.type = "sine";
      oscB.frequency.setValueAtTime(isBigPickup ? 260 : 230, now);
      oscB.frequency.exponentialRampToValueAtTime(isBigPickup ? 520 : 420, now + (isBigPickup ? 0.2 : 0.14));
      oscB.connect(gain);
      oscB.start(now);
      oscB.stop(now + (isBigPickup ? 0.22 : 0.15));
    } catch {
      // Ignore audio failures silently.
    }
  }

  function toggleBoostTrail() {
    setBoostTrailEnabled((prev) => {
      const next = !prev;
      if (next) {
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx();
          if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume().catch(() => {});
        } catch {
          // Ignore audio init failure.
        }
      }
      return next;
    });
  }

  useEffect(() => {
    if (!boostTrailEnabled) {
      setBoostTrail([]);
      setBoostPads([]);
      setBoostFuel(100);
      boostFuelRef.current = 100;
      boostPadsRef.current = [];
      lastPointRef.current = null;
      return undefined;
    }

    const makePad = (id) => {
      const width = Math.max(320, window.innerWidth || 1280);
      const height = Math.max(240, window.innerHeight || 720);
      const big = Math.random() < 0.24;
      return {
        id,
        x: 36 + Math.random() * Math.max(80, width - 72),
        y: 36 + Math.random() * Math.max(80, height - 72),
        size: big ? 26 : 18,
        value: big ? 34 : 12,
        active: true,
        respawnAt: 0,
      };
    };

    const initialPads = Array.from({ length: 16 }, (_, idx) => makePad(idx + 1));
    setBoostPads(initialPads);
    boostPadsRef.current = initialPads;
    setBoostFuel(100);
    boostFuelRef.current = 100;

    let raf = 0;
    const onMove = (event) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = Number(event.clientX || 0);
        const y = Number(event.clientY || 0);
        const prev = lastPointRef.current || { x, y };
        const vx = x - prev.x;
        const vy = y - prev.y;
        lastPointRef.current = { x, y };
        const speed = Math.hypot(vx, vy);
        const dx = -vx * 0.28 + (Math.random() * 18 - 9);
        const dy = -vy * 0.28 + (Math.random() * 18 - 9);
        const fuelNow = Number(boostFuelRef.current || 0);
        if (fuelNow > 0) {
          const item = {
            id: trailIdRef.current++,
            x,
            y,
            dx,
            dy,
            createdAt: Date.now(),
          };
          setBoostTrail((prevItems) => [...prevItems.slice(-160), item]);
        } else {
          setBoostTrail([]);
        }
        setBoostFuel((prevFuel) => Math.max(0, prevFuel - speed * 0.032));
        const now = Date.now();
        let gain = 0;
        const currentPads = Array.isArray(boostPadsRef.current) ? boostPadsRef.current : [];
        let changed = false;
        const nextPads = currentPads.map((pad) => {
          if (!pad.active) return pad;
          const dist = Math.hypot(x - pad.x, y - pad.y);
          if (dist > pad.size + 12) return pad;
          gain += Number(pad.value || 0);
          changed = true;
          return {
            ...pad,
            active: false,
            respawnAt: now + 1200 + Math.round(Math.random() * 2000),
          };
        });
        if (changed) {
          boostPadsRef.current = nextPads;
          setBoostPads(nextPads);
        }
        if (gain > 0) {
          setBoostFuel((prevFuel) => Math.min(100, prevFuel + gain));
          playBoostPickupSound(gain >= 30);
        }
      });
    };

    const cleanupTimer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - 760;
      setBoostTrail((prevItems) => prevItems.filter((item) => item.createdAt >= cutoff));
      setBoostFuel((prevFuel) => Math.max(0, prevFuel - 0.35));
      setBoostPads((prevPads) => {
        const nextPads = prevPads.map((pad) => {
          if (pad.active || now < Number(pad.respawnAt || 0)) return pad;
          const width = Math.max(320, window.innerWidth || 1280);
          const height = Math.max(240, window.innerHeight || 720);
          return {
            ...pad,
            x: 36 + Math.random() * Math.max(80, width - 72),
            y: 36 + Math.random() * Math.max(80, height - 72),
            active: true,
            respawnAt: 0,
          };
        });
        boostPadsRef.current = nextPads;
        return nextPads;
      });
    }, 80);

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      clearInterval(cleanupTimer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [boostTrailEnabled]);

  useEffect(() => {
    boostFuelRef.current = boostFuel;
  }, [boostFuel]);

  useEffect(() => {
    boostPadsRef.current = boostPads;
  }, [boostPads]);

  return {
    boostTrailEnabled,
    boostTrail,
    boostFuel,
    boostPads,
    toggleBoostTrail,
  };
}
