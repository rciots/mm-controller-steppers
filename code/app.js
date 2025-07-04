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
            console.error('Error opening port:', err);
            handleMKSError(err);
            return;
        }

        console.log('Port opened successfully');
        
        // Connection verification timeout
        const connectionTimeout = setTimeout(() => {
            console.log('Connection timeout - No response from MKS');
            handleMKSError(new Error('Connection timeout'));
        }, 5000); // Aumentado a 5 segundos

        const dataHandler = (data) => {
            if (data.toString().includes('Marlin')) {
                clearTimeout(connectionTimeout);
                console.log('MKS connected successfully');
                mksport.removeListener('data', dataHandler); // Dejar de escuchar eventos data
                startSerial(mksport);
            }
        };

        mksport.on('data', dataHandler);

        // Enviar comando M115 para obtener información del dispositivo
        mksport.write('M115\n', (err) => {
            if (err) {
                console.error('Error sending M115 command:', err);
                handleMKSError(err);
            } else {
                console.log('M115 command sent successfully');
            }
        });

        // Configurar eventos de error y cierre
        mksport.on('error', (err) => {
            console.error('Serial port error:', err);
            handleMKSError(err);
        });

        mksport.on('close', () => {
            console.log('Serial port closed');
            handleMKSError();
        });
    });
}

// Try to connect every 10 seconds
setInterval(tryConnectMKS, 10000);


function startSerial(mksport) {
    if (mksport) {
        mksport.write('M83\n', (err) => {
            if (err) {
                console.error('Error sending G-code:', err.message);
            }
        });
        setTimeout(() => {
            console.log('Moving to initial position');
            mksport.write('G0 X12.3 Y12 Z11.7\n', (err) => {
                if (err) {
                    console.error('Error sending G-code:', err.message);
                }
            });
        }, 2000);
        socket.on('endgame', (data) => {

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
        socket.on('phase', (data) => {
            console.log("phase: " + data);
            if (data === "preStart") {
                console.log("Moving to initial position (preStart)");
                mksport.write('G0 X12.3 Y12 Z11.7\n', (err) => {
                    if (err) console.error('Error sending G-code:', err.message);
                });
            } else if (data === "start") {
                console.log("Moving to initial position (start)");
                mksport.write('G0 X12.3 Y12 Z11.7\n', (err) => {
                    if (err) console.error('Error sending G-code:', err.message);
                });
            } else if (data === "end") {
                console.log("phase end - Checking MKS connection");
                if (!mksport || !mksport.isOpen) {
                    console.error("MKS port not connected or not open");
                    return;
                }

                console.log("Sending first movement command");
                const fullHeights = calculateMotorHeights(7, inclination);
                mksport.write(`G0 X${fullHeights.h_A} Y${fullHeights.h_B} Z${fullHeights.h_C}\n`, (err) => {
                    if (err) {
                        console.error('Error sending first G-code:', err.message);
                        return;
                    }
                    console.log("First movement command sent successfully");
                    
                    setTimeout(() => {
                        console.log("Sending second movement command");
                        const fullHeights = calculateMotorHeights(4, inclination);
                        mksport.write(`G0 X${fullHeights.h_A} Y${fullHeights.h_B} Z${fullHeights.h_C}\n`, (err) => {
                            if (err) {
                                console.error('Error sending second G-code:', err.message);
                                return;
                            }
                            console.log("Second movement command sent successfully");
                            
                            setTimeout(() => {
                                console.log("Sending third movement command");
                                const fullHeights = calculateMotorHeights(2, inclination);
                                mksport.write(`G0 X${fullHeights.h_A} Y${fullHeights.h_B} Z${fullHeights.h_C}\n`, (err) => {
                                    if (err) {
                                        console.error('Error sending third G-code:', err.message);
                                        return;
                                    }
                                    console.log("Third movement command sent successfully");
                                    
                                    setTimeout(() => {
                                        console.log("Sending fourth movement command");
                                        const fullHeights = calculateMotorHeights(7, inclination);
                                        mksport.write(`G0 X${fullHeights.h_A} Y${fullHeights.h_B} Z${fullHeights.h_C}\n`, (err) => {
                                            if (err) {
                                                console.error('Error sending fourth G-code:', err.message);
                                                return;
                                            }
                                            console.log("Fourth movement command sent successfully");
                                        });
                                        setTimeout(() => {
                                            console.log("Sending fifth movement command");
                                            mksport.write('G0 X12.3 Y12 Z11.7\n', (err) => {
                                                if (err) console.error('Error sending G-code:', err.message);
                                            });
                                            setTimeout(() => {
                                                console.log("Sending archimedean spiral command");
                                                mksport.write('G1 E2000 F2000\n', (err) => {
                                                    if (err) {
                                                        console.error('Error sending G-code:', err.message);
                                                    } 
                                                });
                                            },500);
                                        }, 4000);
                                    }, 800);
                                });
                            }, 600);
                        });
                    }, 2000);
                });
            }
        });
    }
}

function moveMotor(mksport, direction) {
    console.log("Moving motor to direction: " + direction);
    if (direction === currentDirection) {
        return;
    }

    if (movementTimeout) {
        clearTimeout(movementTimeout);
        movementTimeout = null;
    }

    // Definir direcciones compatibles
    const compatibleDirections = {
        0: [], 1: [5,6], 2: [7,8], 3: [6,8], 4: [5,7],
        5: [1,4], 6: [1,3], 7: [2,4], 8: [2,3]
    };

    const isCompatible = currentDirection !== 0 && 
                        compatibleDirections[currentDirection].includes(direction);
    currentDirection = direction;

    if (isCompatible) {
        const fullHeights = calculateMotorHeights(direction, inclination);
        mksport.write(`G0 X${fullHeights.h_A} Y${fullHeights.h_B} Z${fullHeights.h_C}\n`, (err) => {
            if (err) console.error('Error sending G-code:', err.message);
        });
        return;
    }

    const halfHeights = calculateMotorHeights(direction, HALF_INCLINATION);
    mksport.write(`G0 X${halfHeights.h_A} Y${halfHeights.h_B} Z${halfHeights.h_C}\n`, (err) => {
        if (err) console.error('Error sending G-code:', err.message);
    });

    movementTimeout = setTimeout(() => {
        if (currentDirection === direction) {
            const fullHeights = calculateMotorHeights(direction, inclination);
            mksport.write(`G0 X${fullHeights.h_A} Y${fullHeights.h_B} Z${fullHeights.h_C}\n`, (err) => {
                if (err) console.error('Error sending G-code:', err.message);
            });
        }
    }, 500);
}

function calculateMotorHeights(direction, currentInclination) {
    const initialHeight = 13;
    const initialHeightA = 12.3;
    const initialHeightB = 12;
    const initialHeightC = 11.7;

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
        h_A: clamp(h_A, 8, 22),
        h_B: clamp(h_B, 8, 22),
        h_C: clamp(h_C, 8, 22)
    };
}
