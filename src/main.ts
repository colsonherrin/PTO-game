import { Game } from './game/game';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  try {
    const game = new Game(canvas);
    await game.init();
  } catch (e) {
    console.error(e);
    const err = document.getElementById('err')!;
    err.style.display = 'flex';
    err.innerHTML = `<div><h2>PTO couldn't start</h2><p>${String((e as Error).message ?? e)}</p><p>PTO needs a desktop browser with WebGL2 (Chrome, Edge, Firefox or Safari 15+).</p></div>`;
    document.getElementById('loading')!.style.display = 'none';
  }
}
void boot();
