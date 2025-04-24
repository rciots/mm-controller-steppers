const { SerialPort } = require('serialport');
const { io } = require('socket.io-client');
var cliport = process.env.CLI_PORT || 8080;
var connectorsvc= process.env.CONNECTOR_SVC || "mm-ws-connector.mm-ws-connector.svc.cluster.local";
const socket = io('http://' + connectorsvc + ':' + cliport, { extraHeaders: { origin: 'controller-steppers' } });

socket.on('connect', () => {
    console.log('Connected to Socket.IO server');
});

let mksport = null;
const inclination = 4;

const fs = require('fs');
const path = require('path');

// add 5 seconds delay
setTimeout(() => {
    const serialDevices = fs.readdirSync('/dev')
        .filter(file => file.startsWith('ttyUSB'))
        .map(file => path.join('/dev', file));

    let ttyUSB = "";
    for (let i = 0; i < serialDevices.length; i++) {
        ttyUSB = serialDevices[i];
        console.log('Path:', ttyUSB);
        try {
            let mksporttest = new SerialPort({
                path: ttyUSB,
                baudRate: 250000
            });

            let errorHandled = false;
            mksporttest.on('error', (err) => {
                if (!errorHandled) {
                    console.log('Error on port', ttyUSB, ':', err.message);
                    errorHandled = true;
                    mksporttest.close();
                }
            });

            let dataReceived = false;
            let ttyTimeout = setTimeout(() => {
                if (!dataReceived) {
                    console.log('Timeout, closing port:', mksporttest.path);
                    mksporttest.close();
                }
            }, 1000);

            mksporttest.write('0\n');

            mksporttest.on('data', (data) => {
                dataReceived = true;
                clearTimeout(ttyTimeout);
                
                if (data.toString().includes('Unknown command')) {
                    console.log('MKS port:', mksporttest.path);
                    mksporttest.close();
                    try {
                        mksport = new SerialPort({
                            path: ttyUSB,
                            baudRate: 250000
                        });
                        mksport.on('error', (err) => {
                            console.log('Error on MKS port:', err.message);
                            if (mksport && mksport.isOpen) {
                                mksport.close();
                            }
                        });
                        startSerial(mksport);
                    } catch (err) {
                        console.log('Error creating MKS port:', err.message);
                    }
                } else {
                    console.log('Arduino founded, skiping to next device');
                    console.log("arduino path:", mksporttest.path);
                    mksporttest.close();
                }
            });
        } catch (err) {
            console.log('Error with port', ttyUSB, ':', err.message);
            continue;
        }
    }
}, 5000);
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
            mksport.write('G1 E1400 F6000\n', (err) => {
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
    
        }
        );
    }
}

function moveMotor(mksport, direction) {
    const { h_A, h_B, h_C } = calculateMotorHeights(direction);
    mksport.write(`G0 X${h_A} Y${h_B} Z${h_C}\n`, (err) => {
        if (err) {
            console.error('Error sending G-code:', err.message);
        } 
    });
}

function calculateMotorHeights(direction) {

    const initialHeight = 13;
    const initialHeightA = 13;
    const initialHeightB = 14;
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
            Y = -inclination;
            break;
        case 2:
            X = 0;
            Y = inclination;
            break;
        case 3: 
            X = inclination;
            Y = 0;
            break;
        case 4:
            X = -inclination;
            Y = 0;
            break;
        case 5:
            X = -inclination * Math.cos(Math.PI / 4);
            Y = -inclination * Math.sin(Math.PI / 4);
            break;
        case 6:
            X = inclination * Math.cos(Math.PI / 4);
            Y = -inclination * Math.sin(Math.PI / 4);
            break;
        case 7:
            X = -inclination * Math.cos(Math.PI / 4);
            Y = inclination * Math.sin(Math.PI / 4);
            break;
        case 8:
            X = inclination * Math.cos(Math.PI / 4);
            Y = inclination * Math.sin(Math.PI / 4);
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
