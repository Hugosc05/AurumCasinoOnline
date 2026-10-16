import { useState } from 'react';
import { BotAvatar, type AvatarSpec } from '../components/BotAvatar';
import { Dealer, type DealerPose } from '../games/blackjack/Dealer';

const POSES: { pose: DealerPose; reach: number; card?: boolean }[] = [
  { pose: 'idle', reach: 0 },
  { pose: 'welcome', reach: 0 },
  { pose: 'shuffle', reach: 0 },
  { pose: 'deal', reach: 40, card: true },
  { pose: 'deal', reach: 0, card: true },
  { pose: 'deal', reach: -55, card: true },
  { pose: 'reveal', reach: -20 },
  { pose: 'collect', reach: 0 },
  { pose: 'pay', reach: -30 },
  { pose: 'nod', reach: 0 },
  { pose: 'think', reach: 0 },
];

const AV: AvatarSpec[] = [
  { bg: ['#1f3b73', '#0d1a36'], skin: '#e8b998', hair: { style: 'short', color: '#1d1612' }, outfit: '#c43d3d', accessory: 'visor', pattern: 'stripes' },
  { bg: ['#3d2a6b', '#170f30'], skin: '#f3d2b8', hair: { style: 'long', color: '#b23b3b' }, outfit: '#e8e2f5', accessory: 'earring', pattern: 'dots' },
  { bg: ['#7a1f2b', '#2e0a10'], skin: '#b07d5a', hair: { style: 'curly', color: '#1d1612' }, outfit: '#1d1d24', accessory: 'none', pattern: 'rays' },
  { bg: ['#1a1a1f', '#3b3b46'], skin: '#cf9b78', hair: { style: 'bob', color: '#1d1612' }, outfit: '#cfae6b', accessory: 'glasses', pattern: 'none' },
  { bg: ['#b8541a', '#4a1d05'], skin: '#e8b998', hair: { style: 'shaved', color: '#1d1612' }, outfit: '#20242e', accessory: 'shades', pattern: 'rays' },
  { bg: ['#3f7a3a', '#12280f'], skin: '#f3d2b8', hair: { style: 'wavy', color: '#d9b25f' }, outfit: '#f0c84b', accessory: 'cap', pattern: 'none' },
  { bg: ['#8a2f6f', '#2c0b23'], skin: '#cf9b78', hair: { style: 'bun', color: '#6b3e1f' }, outfit: '#f4dce8', accessory: 'earring', pattern: 'dots' },
  { bg: ['#2b4a8c', '#0c1733'], skin: '#b07d5a', hair: { style: 'short', color: '#a8672e' }, outfit: '#e7e2d4', accessory: 'headphones', pattern: 'none' },
];

/** Galería de desarrollo: poses del crupier y avatares de bots. */
export default function DealerGallery() {
  const [live, setLive] = useState<DealerPose>('idle');
  return (
    <div className="felt min-h-screen p-6">
      <div className="grid grid-cols-4 gap-4">
        {POSES.map((p, i) => (
          <figure key={i} className="rounded-xl bg-black/20 p-2" data-pose={p.pose}>
            <div style={{ width: 260, height: 210 }}><Dealer pose={p.pose} reach={p.reach} speed={0} breathing={false} holdingCard={p.card} /></div>
            <figcaption className="text-center text-xs text-marfil">{p.pose} {p.reach}</figcaption>
          </figure>
        ))}
        <figure className="rounded-xl bg-black/20 p-2">
          <div style={{ width: 260, height: 210 }}><Dealer pose={live} reach={-30} speed={1} breathing /></div>
          <div className="flex flex-wrap gap-1">{POSES.map((p) => <button key={p.pose + p.reach} className="text-[10px] text-niebla" onClick={() => setLive(p.pose)}>{p.pose}</button>)}</div>
        </figure>
      </div>
      <div className="mt-6 flex flex-wrap gap-4">{AV.map((a, i) => <BotAvatar key={i} spec={a} size={96} />)}</div>
    </div>
  );
}
