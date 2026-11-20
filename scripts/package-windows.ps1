[CmdletBinding()]
param(
    [string]$NodePath = (Get-Command node -CommandType Application | Select-Object -First 1).Source,
    [string]$NodeLicensePath,
    [string]$WebViewSdkPath
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$nodePlatform = & $NodePath -p "process.platform+'-'+process.arch"
if ($LASTEXITCODE -or $nodePlatform -ne 'win32-x64') { throw 'Use Windows x64 Node.js.' }
$nodeVersion = & $NodePath --version
if ($LASTEXITCODE -or $nodeVersion -notmatch '^v(24|25|26)\.\d+\.\d+$') { throw 'Node.js 24 or later is required.' }
$version = (Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version
$buildTime = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "鲸之心-桌面版-$version-win-x64-$buildTime"
$dist = Join-Path $project 'dist'
$release = Join-Path $dist $name
$app = Join-Path $release 'app'
$runtime = Join-Path $release 'runtime'
New-Item -Type Directory -Path $app,$runtime,(Join-Path $app 'node_modules') | Out-Null
Copy-Item -LiteralPath (Join-Path $project 'LICENSE') -Destination $release
foreach ($entry in 'server.mjs','core.mjs','memory.mjs','handwritten.mjs','public','roles','desktop') {
    Copy-Item -LiteralPath (Join-Path $project $entry) -Destination $app -Recurse
}
$locked = (Get-Content -LiteralPath (Join-Path $project 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable).packages
foreach ($dependency in 'js-yaml','argparse') {
    $from = Join-Path $project "node_modules/$dependency"
    $installed = (Get-Content -LiteralPath (Join-Path $from 'package.json') -Raw | ConvertFrom-Json).version
    if ($installed -ne $locked["node_modules/$dependency"].version) { throw "$dependency version differs from package-lock.json." }
    Copy-Item -LiteralPath $from -Destination (Join-Path $app 'node_modules') -Recurse
}
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $runtime 'node.exe')
$license = Join-Path $runtime 'LICENSE.txt'
if ($NodeLicensePath) {
    Copy-Item -LiteralPath $NodeLicensePath -Destination $license
} else {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile $license
}
if ((Get-Item -LiteralPath (Join-Path $runtime 'LICENSE.txt')).Length -lt 1000) { throw 'Node.js license is incomplete.' }

$sdkVersion = '1.0.3405.78'
if (-not $WebViewSdkPath) {
    $sdkCache = Join-Path ([IO.Path]::GetTempPath()) "heart-webview2-$sdkVersion"
    $WebViewSdkPath = Join-Path $sdkCache 'sdk'
    if (-not (Test-Path -LiteralPath (Join-Path $WebViewSdkPath 'lib/net462/Microsoft.Web.WebView2.Core.dll'))) {
        New-Item -ItemType Directory -Path $sdkCache -Force | Out-Null
        $sdkArchive = Join-Path $sdkCache 'sdk.zip'
        $uri = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg"
        Invoke-WebRequest -Uri $uri -OutFile $sdkArchive
        Expand-Archive -LiteralPath $sdkArchive -DestinationPath $WebViewSdkPath -Force
    }
}
$webCore = Join-Path $release 'Microsoft.Web.WebView2.Core.dll'
$webForms = Join-Path $release 'Microsoft.Web.WebView2.WinForms.dll'
Copy-Item -LiteralPath (Join-Path $WebViewSdkPath 'lib/net462/Microsoft.Web.WebView2.Core.dll') -Destination $webCore
Copy-Item -LiteralPath (Join-Path $WebViewSdkPath 'lib/net462/Microsoft.Web.WebView2.WinForms.dll') -Destination $webForms
Copy-Item -LiteralPath (Join-Path $WebViewSdkPath 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $release
Copy-Item -LiteralPath (Join-Path $WebViewSdkPath 'LICENSE.txt') -Destination (Join-Path $release 'WebView2-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $WebViewSdkPath 'NOTICE.txt') -Destination (Join-Path $release 'WebView2-NOTICE.txt')

$csc = Join-Path $env:windir 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$source = Join-Path $project 'desktop/Launcher.cs'
$windowSource = Join-Path $project 'desktop/ChatWindow.cs'
$appIcon = Join-Path $project 'desktop/app.ico'
$launcher = Join-Path $release '打开鲸之心.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/reference:$webCore" "/reference:$webForms" "/win32icon:$appIcon" "/out:$launcher" $source $windowSource
if ($LASTEXITCODE) { throw 'Windows launcher build failed.' }
Copy-Item -LiteralPath $launcher -Destination (Join-Path $release '预览鲸之心.exe')
@"
鲸之心 $version · Windows x64

直接打开本文件夹中的启动程序。移动应用时请一起移动完整文件夹。
打开鲸之心.exe   角色新建、对话和记忆。普通聊天在设置中填写 DeepSeek API Key。
预览鲸之心.exe   打开虚构示例。对话侧栏可换角色，记忆页可查看约定的改期版本和共同经历。

应用在自己的 Windows 窗口内运行，通过 Microsoft WebView2 Runtime 显示界面。
应用自带 Node.js，只监听本机回环地址。关闭窗口后，本地进程会退出。

正式使用的数据位于 %LOCALAPPDATA%\HeartOfDeepseek\App\Data。
预览有独立目录 %LOCALAPPDATA%\HeartOfDeepseek\Preview\Data。
首次打开正式应用使用新的本地数据目录，已有同目录数据会继续使用。预览在首次打开时生成示例。
"@ | Set-Content -Encoding utf8BOM (Join-Path $release '使用说明.txt')

[PSCustomObject]@{ Release=$release; Launcher=$launcher; Preview=(Join-Path $release '预览鲸之心.exe') }
