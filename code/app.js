const { SerialPort } = require('serialport');
const { io } = require('socket.io-client');
var cliport = process.env.CLI_PORT || 8080;
var connectorsvc= process.env.CONNECTOR_SVC || "mm-ws-connector.mm-ws-connector.svc.cluster.local";
const socket = io('http://' + connectorsvc + ':' + cliport, { extraHeaders: { origin: 'controller-steppers' } });

const MKS_PATH = process.env.MKS_PATH || '/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0';
const inclination = 4;
const HALF_INCLINATION = inclination / 2;

socket.on('connect', () => {
    console.log('Connected to Socket.IO server');
});

let mksport = null;
let currentDirection = 0;
let movementTimeout = null;

function handleMKSError(err) {
    console.log('MKS error/disconnection:', err ? err.message : 'Connection lost');
    if (mksport) {
        mksport.close();
        mksport = null;
    }
}

function tryConnectMKS() {
    if (mksport) {
        return; // Connection already established
    }

    console.log('Attempting to connect to MKS...');
    mksport = new SerialPort({
        path: MKS_PATH,
        baudRate: 250000,
        autoOpen: false
    });

    mksport.open((err) => {
        if (err) {
            handleMKSError(err);
            return;
        }

        console.log('Port opened successfully');
        const parser = mksport.pipe(new ReadlineParser({ delimiter: '\r\n' }));
        
        // Connection verification timeout
        const connectionTimeout = setTimeout(() => {
            handleMKSError(new Error('Connection timeout'));
        }, 2000);

        parser.on('data', (data) => {
            console.log('Received data:', data.toString());
            if (data.toString().includes('Unknown command')) {
                clearTimeout(connectionTimeout);
                console.log('MKS connected successfully');
                startSerial(mksport);
            }
        });

        mksport.write('0\n', (err) => {
            if (err) {
                handleMKSError(err);
            }
        });
    });

    mksport.on('error', handleMKSError);
    mksport.on('close', () => handleMKSError());
}

// Try to connect every 5 seconds
setInterval(tryConnectMKS, 5000);

// Try first connection immediately
tryConnectMKS();

function startSerial(mksport) {
    if (mksport) {
        mksport.write('M83\n', (err) => {
            if (err) {
                console.error('Error sending G-code:', err.message);
            }
        });
        setTimeout(() => {
            console.log('Moving to initial position');
            mksport.write('G0 X13 Y14 Z13\n', (err) => {
                if (err) {
                    console.error('Error sending G-code:', err.message);
                }
            });
        }, 2000);
        socket.on('endgame', () => {
            mksport.write('G0 E1400 F6000\n', (err) => {
                if (err) {
                    console.error('Error sending G-code:', err.message);
                } 
            });
        });
        socket.on('movement', (data) => {
            if (!data.up && !data.down && !data.left && !data.right) {
                moveMotor(mksport, 0);
            } else if (data.up && !data.down && !data.left && !data.right) {
                moveMotor(mksport, 1);
            } else if (!data.up && data.down && !data.left && !data.right) {
                moveMotor(mksport, 2);
            } else if (!data.up && !data.down && data.left && !data.right) {
                moveMotor(mksport, 3);
            } else if (!data.up && !data.down && !data.left && data.right) {
                moveMotor(mksport, 4);
            } else if (data.up && !data.down && !data.left && data.right) {
                moveMotor(mksport, 5);
            } else if (data.up && !data.down && data.left && !data.right) {
                moveMotor(mksport, 6);
            } else if (!data.up && data.down && !data.left && data.right) {
                moveMotor(mksport, 7);
            } else if (!data.up && data.down && data.left && !data.right) {
                moveMotor(mksport, 8);
            } else {
                moveMotor(mksport, 0);
            }
        });
    }
}

function moveMotor(mksport, direction) {
    // If direction hasn't changed, don't do anything
    if (direction === currentDirection) {
        return;
    }

    // Clear any existing timeout
    if (movementTimeout) {
        clearTimeout(movementTimeout);
        movementTimeout = null;
    }

    // Store current direction
    currentDirection = direction;

    // First move: half inclination
    const halfHeights = calculateMotorHeights(direction, HALF_INCLINATION);
    mksport.write(`G0 X${halfHeights.h_A} Y${halfHeights.h_B} Z${halfHeights.h_C}\n`, (err) => {
        if (err) {
            console.error('Error sending G-code:', err.message);
        }
    });

    // Set timeout for full movement
    movementTimeout = setTimeout(() => {
        if (currentDirection === direction) { // Only move if direction hasn't changed
            const fullHeights = calculateMotorHeights(direction, inclination);
            mksport.write(`G0 X${fullHeights.h_A} Y${fullHeights.h_B} Z${fullHeights.h_C}\n`, (err) => {
                if (err) {
                    console.error('Error sending G-code:', err.message);
                }
            });
        }
    }, 500);
}

function calculateMotorHeights(direction, currentInclination) {
    const initialHeight = 13;
    const initialHeightA = 13;
    const initialHeightB = 13;
    const initialHeightC = 13;

    const motorPositions = [
        { x: -5, y: -8.66 },
        { x: 10, y: 0 },        
        { x: -5, y: 8.66 }      
    ];

    let X = 0, Y = 0;

    switch (direction) {
        case 0: 
            X = 0;
            Y = 0;
            break;
        case 1:
            X = 0;
            Y = -currentInclination;
            break;
        case 2:
            X = 0;
            Y = currentInclination;
            break;
        case 3: 
            X = currentInclination;
            Y = 0;
            break;
        case 4:
            X = -currentInclination;
            Y = 0;
            break;
        case 5:
            X = -currentInclination * Math.cos(Math.PI / 4);
            Y = -currentInclination * Math.sin(Math.PI / 4);
            break;
        case 6:
            X = currentInclination * Math.cos(Math.PI / 4);
            Y = -currentInclination * Math.sin(Math.PI / 4);
            break;
        case 7:
            X = -currentInclination * Math.cos(Math.PI / 4);
            Y = currentInclination * Math.sin(Math.PI / 4);
            break;
        case 8:
            X = currentInclination * Math.cos(Math.PI / 4);
            Y = currentInclination * Math.sin(Math.PI / 4);
            break;
        default:
            X = 0;
            Y = 0;
            break;
    }

    const h_A = initialHeightA + (motorPositions[0].x * X + motorPositions[0].y * Y) / 10;
    const h_B = initialHeightB + (motorPositions[1].x * X + motorPositions[1].y * Y) / 10;
    const h_C = initialHeightC + (motorPositions[2].x * X + motorPositions[2].y * Y) / 10;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    return {
        h_A: clamp(h_A, 10, 22),
        h_B: clamp(h_B, 10, 22),
        h_C: clamp(h_C, 10, 22)
    };
}
