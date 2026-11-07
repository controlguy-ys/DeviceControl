const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const fs = require('fs');

// 자동 업데이트 관련 추가
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// 개발 모드 체크 (electron-is-dev 없이)
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// 로그 설정
log.transports.file.level = 'info';
autoUpdater.logger = log;

// 전역 변수
let mainWindow;
let port;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,        // 1200 → 1600으로 증가
    height: 1200,       // 900 → 1200으로 증가
    minWidth: 1400,     // 최소 너비도 조정
    minHeight: 1000,    // 최소 높이도 조정
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'assets', 'FPGA_Icon.ico'), // 앱 아이콘 설정
    show: false, // 로딩 완료 후 표시
    titleBarStyle: 'default',
    autoHideMenuBar: true, // 메뉴바 자동 숨김 (Alt키로 표시 가능)
  });

  if (isDev) {
    // 개발 모드: Vite 개발 서버에 연결
    console.log('Development mode: Loading from Vite dev server');
    mainWindow.loadURL('http://localhost:5173');
    // 개발 모드에서는 DevTools 열기
    mainWindow.webContents.openDevTools();
  } else {
    // 프로덕션 모드: 빌드된 파일 로드
    const indexPath = path.join(__dirname, 'device-control-app', 'dist', 'index.html');
    console.log('Production mode: Loading from', indexPath);
    
    // 파일 존재 여부 확인
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      console.error('Build file not found:', indexPath);
      console.log('Please run "npm run build-renderer" first');
      // 에러 페이지 표시
      mainWindow.loadURL(`data:text/html,
        <html>
          <head>
            <title>FPGA Device Control - Build Error</title>
          </head>
          <body style="font-family: Arial; padding: 20px; background: #242424; color: white; text-align: center;">
            <h1 style="color: #ff6b6b;">⚠️ Build Error</h1>
            <p>The React app hasn't been built yet.</p>
            <p>Please run: <code style="background: #333; padding: 8px; border-radius: 4px; color: #61dafb;">npm run build-renderer</code></p>
            <p>Then restart the application.</p>
            <hr style="border-color: #444; margin: 20px 0;">
            <small style="color: #888;">FPGA Device Control App v${app.getVersion()}</small>
          </body>
        </html>
      `);
    }
  }

  // 로딩 완료 후 창 표시
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // 프로덕션 모드에서만 자동 업데이트 체크
    if (!isDev) {
      // 앱 시작 5초 후 업데이트 체크 (UI 로딩 완료 후)
      setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
      }, 5000);
    }
  });

  // 로드 실패 시 에러 처리
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', errorCode, errorDescription, validatedURL);
    if (isDev && errorCode === -102) {
      console.log('Development server not running. Please run "npm run dev" instead of "npm start"');
      
      // 개발 서버 연결 실패 시 재시도 옵션 제공
      const retryHTML = `
        <html>
          <head><title>Development Server Not Found</title></head>
          <body style="font-family: Arial; padding: 20px; background: #242424; color: white; text-align: center;">
            <h1 style="color: #ff6b6b;">🔧 Development Server Not Running</h1>
            <p>Please start the development server first:</p>
            <code style="background: #333; padding: 8px; border-radius: 4px; color: #61dafb; display: block; margin: 20px 0;">npm run dev</code>
            <button onclick="location.reload()" style="background: #61dafb; color: #242424; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin: 10px;">
              🔄 Retry Connection
            </button>
          </body>
        </html>
      `;
      mainWindow.loadURL(`data:text/html,${encodeURIComponent(retryHTML)}`);
    }
  });

  // 자동 업데이트 이벤트 처리
  setupAutoUpdater(mainWindow);

  return mainWindow;
}

// 자동 업데이트 설정
function setupAutoUpdater(window) {
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    console.log('🔍 업데이트 확인 중...');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
    console.log('📦 업데이트 사용 가능:', info.version);
    
    // 렌더러에 업데이트 알림 전송
    window.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
    console.log('✅ 최신 버전입니다:', info.version);
  });

  autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater:', err);
    console.error('❌ 자동 업데이트 오류:', err.message);
    
    // 업데이트 오류를 렌더러에 알림
    window.webContents.send('update-error', {
      message: err.message
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const logMessage = `Download speed: ${Math.round(progressObj.bytesPerSecond / 1024)}KB/s - Downloaded ${Math.round(progressObj.percent)}% (${Math.round(progressObj.transferred / 1024 / 1024)}MB/${Math.round(progressObj.total / 1024 / 1024)}MB)`;
    log.info(logMessage);
    console.log('📥 다운로드 진행률:', Math.round(progressObj.percent) + '%');
    
    // 다운로드 진행률을 렌더러에 전송
    window.webContents.send('download-progress', {
      percent: Math.round(progressObj.percent),
      transferred: Math.round(progressObj.transferred / 1024 / 1024),
      total: Math.round(progressObj.total / 1024 / 1024),
      bytesPerSecond: Math.round(progressObj.bytesPerSecond / 1024)
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);
    console.log('✅ 업데이트 다운로드 완료:', info.version);
    
    // 업데이트 다운로드 완료를 렌더러에 알림
    window.webContents.send('update-downloaded', {
      version: info.version
    });
    
    // 5초 후 자동 재시작 (사용자에게 알림 표시 시간 제공)
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 5000);
  });
}

app.whenReady().then(() => {
  createWindow();

  // 시리얼 포트 목록 조회
  ipcMain.handle('get-serial-ports', async () => {
    try {
      console.log('Getting serial ports...');
      const ports = await SerialPort.list();
      console.log('Found ports:', ports);
      return ports.map(port => ({
        path: port.path,
        manufacturer: port.manufacturer || 'Unknown',
        pnpId: port.pnpId || '',
        serialNumber: port.serialNumber || '',
        vendorId: port.vendorId || '',
        productId: port.productId || ''
      }));
    } catch (error) {
      console.error("Failed to list serial ports:", error);
      return [];
    }
  });

  // 시리얼 포트 열기
  ipcMain.handle('open-serial-port', async (event, portPath, baudRate, dataBits, parity, stopBits) => {
    console.log(`Opening port: ${portPath}, ${baudRate}-${dataBits}-${parity}-${stopBits}`);
    
    if (port && port.isOpen) {
      console.warn(`Port ${port.path} is already open.`);
      return { success: false, message: `Port ${port.path} is already open.` };
    }
    
    try {
      port = new SerialPort({
        path: portPath,
        baudRate: baudRate,
        dataBits: dataBits,
        parity: parity,
        stopBits: stopBits,
        // 추가 옵션
        autoOpen: false, // 수동으로 열기
        lock: false // 포트 잠금 해제
      });

      // 포트 수동으로 열기
      return new Promise((resolve) => {
        port.open((err) => {
          if (err) {
            console.error(`Failed to open port ${portPath}:`, err.message);
            resolve({ success: false, message: `Failed to open port: ${err.message}` });
            return;
          }

          console.log(`Serial port ${portPath} opened successfully`);
          resolve({ success: true, message: `Port ${portPath} opened successfully.` });

          // 이벤트 리스너 설정
          port.on('data', (data) => {
            const receivedData = data.toString('utf8');
            console.log('Data from serial:', receivedData);
            event.sender.send('serial-data-received', receivedData);
          });

          port.on('close', () => {
            console.log(`Serial port ${portPath} closed.`);
            event.sender.send('serial-port-status', { 
              isOpen: false, 
              path: portPath, 
              message: `Port ${portPath} closed.` 
            });
          });

          port.on('error', (err) => {
            console.error(`Serial port ${portPath} error:`, err.message);
            event.sender.send('serial-port-status', { 
              isOpen: false, 
              path: portPath, 
              error: err.message, 
              message: `Port ${portPath} error: ${err.message}` 
            });
          });

          // 성공 상태 전송
          event.sender.send('serial-port-status', { 
            isOpen: true, 
            path: portPath, 
            message: `Port ${portPath} opened successfully.` 
          });
        });
      });

    } catch (error) {
      console.error(`Failed to create serial port ${portPath}:`, error);
      return { success: false, message: `Failed to create port: ${error.message}` };
    }
  });

  // 시리얼 포트 닫기
  ipcMain.handle('close-serial-port', async (event) => {
    console.log('Closing serial port...');
    
    if (port && port.isOpen) {
      return new Promise((resolve) => {
        port.close((err) => {
          if (err) {
            console.error("Error closing port:", err);
            resolve({ success: false, message: `Error closing port: ${err.message}` });
          } else {
            console.log("Port successfully closed.");
            port = null; // 포트 참조 해제
            resolve({ success: true, message: "Port closed successfully." });
          }
        });
      });
    } else {
      console.log("No port is currently open.");
      return { success: false, message: "No port is currently open." };
    }
  });

  // 시리얼 포트에 데이터 쓰기
  ipcMain.handle('write-to-serial-port', async (event, data, encoding) => {
    console.log(`Writing to serial port: "${data}" with encoding: ${encoding}`);
    
    if (port && port.isOpen) {
      return new Promise((resolve) => {
        port.write(data, encoding, (err) => {
          if (err) {
            console.error("Error writing to port:", err);
            resolve({ success: false, message: `Error writing: ${err.message}` });
          } else {
            console.log(`Data "${data}" written successfully.`);
            resolve({ success: true, message: `Data "${data}" written successfully.` });
          }
        });
      });
    } else {
      console.log("No port open to write to.");
      return { success: false, message: "No port open to write to." };
    }
  });

  // 자동 업데이트 관련 IPC 핸들러
  ipcMain.handle('check-for-updates', () => {
    if (!isDev) {
      console.log('🔍 수동 업데이트 확인...');
      autoUpdater.checkForUpdatesAndNotify();
      return { success: true, message: 'Checking for updates...' };
    } else {
      return { success: false, message: 'Auto-update not available in development mode.' };
    }
  });

  ipcMain.handle('restart-app', () => {
    console.log('🔄 앱 재시작...');
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // 기타 IPC 핸들러
  ipcMain.on('toMain', (event, arg) => {
    console.log('Message from renderer:', arg);
    event.sender.send('fromMain', `Hello from Main Process! You sent: ${arg}`);
  });

  ipcMain.handle('get-file-path', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Text Files', extensions: ['txt', 'log'] },
        { name: 'Config Files', extensions: ['json', 'yaml', 'yml'] }
      ]
    });
    if (canceled) {
      return undefined;
    } else {
      return filePaths[0];
    }
  });

  // 앱 정보 다이얼로그
  ipcMain.handle('show-about-dialog', async () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'About FPGA Device Control App',
      message: 'FPGA Device Control App',
      detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode.js: ${process.versions.node}\n\nSerial port communication application for FPGA devices.`,
      buttons: ['OK']
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  console.log('App closing...');
  
  // 시리얼 포트 정리
  if (port && port.isOpen) {
    port.close((err) => {
      if (err) console.error("Error closing port on app quit:", err);
      else console.log("Serial port closed on app quit.");
    });
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 앱 종료 전 정리 작업
app.on('before-quit', (event) => {
  console.log('App is about to quit...');
  
  // 시리얼 포트가 열려있으면 닫기
  if (port && port.isOpen) {
    event.preventDefault(); // 종료 지연
    
    port.close((err) => {
      if (err) console.error("Error closing port on quit:", err);
      else console.log("Serial port closed on quit.");
      
      app.quit(); // 실제 종료
    });
  }
});

// 에러 처리
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  log.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  log.error('Unhandled Rejection:', reason);
});