const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const gphoto2 = require('gphoto2');
const { Readable } = require('stream');
const cors = require('cors');
const path = require('path'); 
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const corsOptions = {
  origin: '*', // Mengizinkan semua origin
  methods: ['GET', 'POST'], // Metode HTTP yang diizinkan
  allowedHeaders: ['Content-Type', 'Authorization'], // Header yang diizinkan
};

app.use(cors(corsOptions)); 
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*', // Mengizinkan semua origin untuk WebSocket
    methods: ['GET', 'POST'], // Metode HTTP yang diizinkan
  },
});

const GPhoto = new gphoto2.GPhoto2();

let camera = null;
let availableCameras = [];

// Inisialisasi kamera
GPhoto.list((cameras) => {
  availableCameras = cameras;
  if (cameras.length === 0) {
    console.log('Tidak ada kamera yang terdeteksi');
    return;
  }
  
  // Cari kamera Canon, Sony, atau Nikon terlebih dahulu
  camera = cameras.find(cam => 
    cam.model.toLowerCase().includes('canon') || 
    cam.model.toLowerCase().includes('sony') || 
    cam.model.toLowerCase().includes('nikon')
  );
  
  // Jika tidak ditemukan, gunakan kamera pertama yang tersedia
  if (!camera) {
    console.log('Tidak ada kamera Canon, Sony, atau Nikon yang terdeteksi. Menggunakan kamera yang tersedia.');
    camera = cameras[0];
  }
  
  console.log('Kamera terdeteksi:', camera.model);
});

app.get('/cameras', (req, res) => {
  res.json(availableCameras.map(cam => ({
    model: cam.model,
    port: cam.port
  })));
});

app.get('/current-camera', (req, res) => {
  if (!camera) {
    return res.status(404).json({ error: 'Tidak ada kamera yang aktif' });
  }
  res.json({ model: camera.model, port: camera.port });
});

app.post('/select-camera', (req, res) => {
  const { port } = req.body;
  const selectedCamera = availableCameras.find(cam => cam.port === port);
  if (selectedCamera) {
    camera = selectedCamera;
    res.json({ success: true, message: 'Kamera berhasil dipilih', model: camera.model });
  } else {
    res.status(404).json({ success: false, message: 'Kamera tidak ditemukan' });
  }
});

app.get('/is-dslr-active', (req, res) => {
  res.json({ active: camera !== null });
});

app.get('/capture', (req, res) => {
  if (!camera) {
    return res.status(500).send('Tidak ada kamera yang terdeteksi');
  }

  camera.takePicture({ download: true }, (err, data) => {
    if (err) {
      console.error('Error saat mengambil gambar:', err);
      return res.status(500).send('Error saat mengambil gambar');
    }
    
    res.contentType('image/jpeg');
    res.send(data);
  });
});


io.on('connection', (socket) => {
  let isLiveViewActive = false;
  socket.on('start-live-view', async () => {
    if (!camera) {
      socket.emit('error', 'Tidak ada kamera yang terdeteksi');
      return;
    }

    console.log('Memulai live view...');
    if (isLiveViewActive) {
      socket.emit('info', 'Live view sudah berjalan');
      return;
    }

    isLiveViewActive = true;

    while (isLiveViewActive) {
      try {
        const file = await new Promise((resolve, reject) => {
          camera.takePicture({ download: true }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });

        console.log('jembud');
        socket.emit('live-view-data', file.toString('base64'));
        
        await new Promise(resolve => setTimeout(resolve, 100));  // Delay 100ms
      } catch (error) {
        console.error('Live view error:', error);
        socket.emit('error', 'Gagal mengambil gambar');
        isLiveViewActive = false;
      }
    }

    socket.emit('info', 'Live view dimulai');
  });

  const stopLiveView = () => {
    isLiveViewActive = false;
    socket.emit('info', 'Live view dihentikan');
  };

  socket.on('stop-live-view', stopLiveView);

  socket.on('disconnect', () => {
    console.log('Client terputus');
    stopLiveView();
  });

});


const port = 8080;
server.listen(port, '0.0.0.0', () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
