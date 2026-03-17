#define NeuralVAppName "NeuralV"
#define NeuralVAppVersion GetEnv("NEURALV_VERSION")
#define NeuralVStageDir GetEnv("NEURALV_STAGE_DIR")
#define NeuralVOutputDir GetEnv("NEURALV_OUTPUT_DIR")

[Setup]
AppId={{3B6A40D5-8B77-4A39-8665-54C53B249F55}
AppName={#NeuralVAppName}
AppVersion={#NeuralVAppVersion}
AppPublisher=NeuralV
DefaultDirName={localappdata}\NeuralV
DefaultGroupName=NeuralV
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
PrivilegesRequired=lowest
OutputDir={#NeuralVOutputDir}
OutputBaseFilename=neuralv-setup
UninstallDisplayIcon={app}\NeuralV.exe
SetupLogging=yes
SetupIconFile=..\..\windows-winui\NeuralV.Windows\Assets\NeuralV.ico

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#NeuralVStageDir}\NeuralV\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\NeuralV"; Filename: "{app}\NeuralV.exe"; IconFilename: "{app}\NeuralV.exe"
Name: "{autodesktop}\NeuralV"; Filename: "{app}\NeuralV.exe"; IconFilename: "{app}\NeuralV.exe"

[Run]
Filename: "{app}\NeuralV.exe"; Description: "Launch NeuralV"; Flags: nowait postinstall skipifsilent
