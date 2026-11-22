param(
    [Parameter(Mandatory = $true)][string]$Pdf,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9-]+$')][string]$Label,
    [Parameter(Mandatory = $true)][int[]]$Pages
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1
}
$operationTask = $asTask | Where-Object IsGenericMethodDefinition | Where-Object {
    $_.GetGenericArguments().Count -eq 1
} | Select-Object -First 1
$actionTask = $asTask | Where-Object { -not $_.IsGenericMethodDefinition } | Select-Object -First 1
function Read-Operation($operation, $type) {
    $operationTask.MakeGenericMethod($type).Invoke($null, @($operation)).GetAwaiter().GetResult()
}
$file = Read-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path -LiteralPath $Pdf).Path)) ([Windows.Storage.StorageFile])
$document = Read-Operation ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$destination = Join-Path $root 'data-private\textbook-review'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($number in $Pages) {
    if ($number -lt 1 -or $number -gt $document.PageCount) { throw "Out of range: $number" }
    $page = $document.GetPage($number - 1)
    $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
    try {
        $options = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
        $options.DestinationWidth = 920
        $null = $actionTask.Invoke($null, @($page.RenderToStreamAsync($stream, $options))).GetAwaiter().GetResult()
        $stream.Seek(0)
        $reader = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]::new($stream)
        try {
            $null = Read-Operation ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
            $bytes = New-Object byte[] $stream.Size
            $reader.ReadBytes($bytes)
            $output = Join-Path $destination "$Label-layout-$number.png"
            [IO.File]::WriteAllBytes($output, $bytes)
            Write-Output $output
        } finally { $reader.Dispose() }
    } finally { $page.Dispose(); $stream.Dispose() }
}
