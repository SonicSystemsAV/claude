# Ledgerly launcher
# Starts the local dev server (only if it isn't already running) and opens the app
# in your default browser. Uses port 5173 so your data (stored in the browser's
# IndexedDB for http://localhost:5173) is preserved.

$ProjectDir = 'Z:\Claude Accounting'
$Port = 5173
$Url  = "http://localhost:$Port"

function Test-Port($p) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $p)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

if (-not (Test-Port $Port)) {
    # Launch the Vite dev server in its own minimized window.
    # Close THAT window when you want to shut Ledgerly down.
    Start-Process 'cmd.exe' `
        -ArgumentList '/k "title Ledgerly Server  --  close this window to quit && npm run dev"' `
        -WorkingDirectory $ProjectDir `
        -WindowStyle Minimized

    # Wait for the server to come up (up to ~40 seconds).
    $deadline = (Get-Date).AddSeconds(40)
    while (-not (Test-Port $Port) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
    }
}

# Open the app in the default browser.
Start-Process $Url
