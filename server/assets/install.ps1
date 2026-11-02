# wtow CLI Windows 安装脚本。PowerShell 5.1+ 与 7+ 均兼容。
# 用法：irm __WTOW_BASE_URL__/install.ps1 | iex
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServerUrl = '__WTOW_BASE_URL__'
$BaseUrl = if ($env:WTOW_BASE_URL) { $env:WTOW_BASE_URL.TrimEnd('/') } else { $ServerUrl }
$BinDir  = if ($env:WTOW_BIN_DIR) { $env:WTOW_BIN_DIR } else { "$env:LOCALAPPDATA\wtow\bin" }

# 通过 iex 执行时 exit 会关掉用户的终端窗口，所以用 throw 终止脚本。
function Die($msg) { throw "wtow install: $msg" }

# HTTP 规则与 install.sh 一致：本机、服务端声明的对外地址、或显式 WTOW_ALLOW_HTTP=1。
switch -Wildcard ($BaseUrl) {
    'https://*' { }
    'http://127.0.0.1*' { }
    'http://localhost*' { }
    'http://*' {
        if ($BaseUrl -ne $ServerUrl -and $env:WTOW_ALLOW_HTTP -ne '1') {
            Die "base url must be https (set `$env:WTOW_ALLOW_HTTP=1` to override for private networks): $BaseUrl"
        }
        Write-Warning "wtow install: installing over plain HTTP — tokens will be transmitted unencrypted"
    }
    default { Die "unsupported base url scheme: $BaseUrl" }
}

$target = 'x86_64-pc-windows-msvc'

$tmp = [System.IO.Path]::GetTempPath() + [System.IO.Path]::GetRandomFileName()
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $jsonPath = "$tmp\latest.json"
    Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/dl/latest.json" -OutFile $jsonPath

    $manifest = Get-Content $jsonPath -Raw | ConvertFrom-Json
    $artifact = $manifest.artifacts | Where-Object { $_.target -eq $target } | Select-Object -First 1
    if (-not $artifact) { Die "no build for $target in latest.json" }

    $zipPath = "$tmp\wtow.zip"
    Invoke-WebRequest -UseBasicParsing -Uri $artifact.url -OutFile $zipPath

    # 校验 sha256
    $got = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLower()
    if ($got -ne $artifact.sha256) {
        Die "sha256 mismatch (got $got, expected $($artifact.sha256))"
    }

    Expand-Archive -Path $zipPath -DestinationPath $tmp -Force

    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    Copy-Item "$tmp\wtow.exe" "$BinDir\wtow.exe" -Force

    $ver = & "$BinDir\wtow.exe" --version
    Write-Host "installed $BinDir\wtow.exe ($ver)"

    # 把 BinDir 加进用户 PATH（如果还没有的话）
    $userPath = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    if ($userPath -notlike "*$BinDir*") {
        [System.Environment]::SetEnvironmentVariable('PATH', "$userPath;$BinDir", 'User')
        Write-Host "note: added $BinDir to your user PATH (open a new terminal to take effect)"
    }
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
