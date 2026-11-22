import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  for (const [name, expectedDuration, expectedScenes] of [['process', 24, 6], ['trailer', 9, 3]]) {
    const base64 = (await readFile(new URL(`./out/${name}.webm`, import.meta.url))).toString('base64');
    const result = await page.evaluate(async base64 => {
      const video = document.createElement('video');
      video.muted = true;
      video.src = 'data:video/webm;base64,' + base64;
      document.body.append(video);
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 72;
      const context = canvas.getContext('2d');
      const frames = new Set();
      const capture = () => {
        context.drawImage(video, 0, 0, 128, 72);
        frames.add(canvas.toDataURL());
        if (!video.ended) video.requestVideoFrameCallback(capture);
      };
      const end = new Promise((resolve, reject) => {
        video.onended = resolve;
        video.onerror = () => reject(Error(video.error?.message));
        setTimeout(() => reject(Error('Playback timed out')), 15000);
      });
      video.playbackRate = 4;
      video.requestVideoFrameCallback(capture);
      await video.play();
      await end;
      const result = { width: video.videoWidth, height: video.videoHeight,
        seconds: video.currentTime, distinctFrames: frames.size };
      video.remove();
      return result;
    }, base64);
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
    assert.ok(Math.abs(result.seconds - expectedDuration) < 0.8, JSON.stringify(result));
    assert.ok(result.distinctFrames >= expectedScenes, JSON.stringify(result));
    console.log(name, result);
  }
} finally {
  await browser.close();
}
