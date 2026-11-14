# A FullWidget plugin. FullWidget sends one JSON request per line on stdin; answer with one JSON line on stdout.
# Messages for yourself go to stderr ([Console]::Error.WriteLine); they end up in FullWidget's app.log.

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Send($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 10))
  [Console]::Out.Flush()
}

# What widgets can call: widget.plugin("{name}").call("method", params)
$methods = @{
  hello = { param($p) "Hello, $($p.name)! It's $(Get-Date -Format 'HH:mm:ss')" }
  top = {
    param($p)
    $n = if ($p -and $p.count) { [int]$p.count } else { 5 }
    , @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First $n |
        ForEach-Object { @{ name = $_.ProcessName; mb = [math]::Round($_.WorkingSet64 / 1MB) } })
  }
}

# One request: run the method, send back its result or what went wrong.
function Answer($text) {
  $req = $null
  try {
    $req = $text | ConvertFrom-Json
    $m = $methods[$req.method]
    if (-not $m) { Send @{ id = $req.id; error = "no method '$($req.method)'" }; return }
    Send @{ id = $req.id; result = (& $m $req.params) }
  } catch {
    Send @{ id = $(if ($req) { $req.id } else { $null }); error = $_.Exception.Message }
  }
}

[Console]::Error.WriteLine("started, pid $PID")
# stdin as a stream: [Console]::In waits inside ReadLineAsync in Windows PowerShell
$reader = New-Object IO.StreamReader([Console]::OpenStandardInput(), (New-Object Text.UTF8Encoding $false))
$next = $reader.ReadLineAsync()
while ($true) {
  # While waiting for requests, an event every 10 seconds: widget.plugin("{name}").on("tick", data => …)
  if (-not $next.Wait(10000)) { Send @{ event = "tick"; data = @{ time = (Get-Date -Format "HH:mm:ss") } }; continue }
  $text = $next.Result
  if ($null -eq $text) { break }  # FullWidget closed our input: time to stop
  Answer $text
  $next = $reader.ReadLineAsync()
}
