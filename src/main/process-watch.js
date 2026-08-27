'use strict';

const { spawn } = require('child_process');

function startWmiProcessWatch(onProc) {
  const script = [
    '$q = New-Object System.Management.WqlEventQuery "SELECT * FROM Win32_ProcessStartTrace"',
    '$w = New-Object System.Management.ManagementEventWatcher $q',
    'while ($true) {',
    '  $e = $w.WaitForNextEvent()',
    '  Write-Output ($e.ProcessId.ToString() + "|" + $e.ProcessName + "|" + $e.ParentProcessID.ToString())',
    '}'
  ].join('; ');

  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle', 'Hidden',
    '-Command', script
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const [pid, name, ppid] = line.split('|');
      const id = Number(pid);
      if (!id) continue;
      onProc({
        pid: id,
        name: name || '',
        ppid: Number(ppid) || 0,
        path: ''
      });
    }
  });

  return () => {
    try { child.kill(); } catch {}
  };
}

module.exports = { startWmiProcessWatch };
