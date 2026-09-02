const { exec } = require('child_process');
const script = `
Add-Type -AssemblyName "SharpDX.XInput" -ErrorAction SilentlyContinue
if ([System.Reflection.Assembly]::LoadWithPartialName("SharpDX.XInput")) {
    $controller = New-Object SharpDX.XInput.Controller([SharpDX.XInput.UserIndex]::Any)
    if ($controller.IsConnected) {
        $controller.GetState().Gamepad.Buttons
    }
}
`;
exec(`powershell -Command "${script.replace(/\n/g, ';')}"`, (err, stdout) => {
    console.log("Output:", stdout, "Err:", err);
});
