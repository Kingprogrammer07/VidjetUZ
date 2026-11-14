# FullWidget 插件示例。FullWidget 从 stdin 每行送来一个 JSON 请求，你从 stdout 每行回一个 JSON。
# 给自己看的消息写到 stderr（[Console]::Error.WriteLine），会记进 FullWidget 的 app.log。

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Send($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 10))
  [Console]::Out.Flush()
}

# 组件可以调用的方法：widget.plugin("{name}").call("方法", 参数)
$methods = @{
  hello = { param($p) "你好，$($p.name)！现在是 $(Get-Date -Format 'HH:mm:ss')" }
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
    if (-not $m) { Send @{ id = $req.id; error = "没有方法 '$($req.method)'" }; return }
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
  # 等请求的时候，每 10 秒发一次事件：widget.plugin("{name}").on("tick", data => …)
  if (-not $next.Wait(10000)) { Send @{ event = "tick"; data = @{ time = (Get-Date -Format "HH:mm:ss") } }; continue }
  $text = $next.Result
  if ($null -eq $text) { break }  # FullWidget 关掉了输入：该结束了
  Answer $text
  $next = $reader.ReadLineAsync()
}
