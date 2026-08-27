'use strict';

const { spawn } = require('child_process');

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
function Await-WinRT($WinRtTask, $ResultType) {
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
$op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('Guard Island')
$r = Await-WinRT $op ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
Write-Output ([int]$r)
`;

function requestWindowsHello() {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-STA', '-Command', SCRIPT
    ], { windowsHide: false });
    let out = '';
    let err = '';
    const t = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ ok: false, unavailable: false, message: 'Windows Hello не ответил' });
    }, 120000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', () => {
      clearTimeout(t);
      resolve({ ok: false, unavailable: true, message: 'Не удалось запустить Windows Hello' });
    });
    child.on('close', () => {
      clearTimeout(t);
      const code = Number(String(out).trim().split(/\s+/).pop());
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      const map = {
        1: { unavailable: true, message: 'Windows Hello недоступен на этом ПК' },
        2: { unavailable: true, message: 'Windows Hello не настроен' },
        3: { unavailable: true, message: 'Windows Hello отключён политикой' },
        4: { unavailable: false, message: 'Подтверждение отменено' },
        5: { unavailable: false, message: 'Слишком много попыток' }
      };
      const info = map[code] || {
        unavailable: true,
        message: (err || out || 'Windows Hello недоступен').trim().slice(0, 180)
      };
      resolve({ ok: false, ...info });
    });
  });
}

module.exports = { requestWindowsHello };
