$exe = "$env:LOCALAPPDATA\Programs\Cua\cua-driver\bin\cua-driver.exe"
$process = Start-Process -FilePath $exe -ArgumentList "mcp" -PassThru -NoNewWindow -RedirectStandardInput "in.txt" -RedirectStandardOutput "out.txt"
