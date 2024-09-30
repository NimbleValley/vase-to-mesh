const API_KEY = '1234';

import axios from 'axios';
import fs from 'fs';
import path, { dirname } from 'path';
import express from 'express';
import fileUpload from 'express-fileupload';

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Blob, FileReader } from 'vblob';

// Patch global scope to imitate browser environment.
global.window = global;
global.Blob = Blob;
global.FileReader = FileReader;
global.THREE = THREE;
global.document = {
    createElement: (nodeName) => {
        if (nodeName !== 'canvas') throw new Error(`Cannot create node ${nodeName}`);
        const canvas = new Canvas(256, 256);
        // This isn't working — currently need to avoid toBlob(), so export to embedded .gltf not .glb.
        // canvas.toBlob = function () {
        //   return new Blob([this.toBuffer()]);
        // };
        return canvas;
    }
};

const __dirname = path.resolve();

const app = express();
app.use(express.static('./src'));
app.use(fileUpload());
app.listen(8080);

app.post('/upload', async (req, res) => {
    // Get the file that was set to our field named 'image'
    const image = req.files.image;

    // If no image submitted, exit
    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).send('No files were uploaded.');
    }

    let uploadPath = __dirname + '/temp/vase.jpg';
    console.log(uploadPath);

    // Move the uploaded image to our upload folder
    image.mv(uploadPath, function (err) {
        if (err)
            return res.status(500).send(err);

        segmentImage();
        //res.status(204).send();
        res.redirect('/model.html');
    });
});


function segmentImage() {
    let imagePath = __dirname + '/temp/vase.jpg';

    const image = fs.readFileSync(imagePath, {
        encoding: 'base64'
    });

    axios({
        method: 'POST',
        url: 'https://detect.roboflow.com/bottles-4qqsl/1',
        params: {
            api_key: '9urn0GaYDlCXlxe05a0a'
        },
        data: image,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    })
        .then(function (response) {
            console.log(response.data);
            downloadFile(response.data.predictions[0].points);
        })
        .catch(function (error) {
            console.log(error.message);
        });
}

function downloadFile(points) {
    // Merge by distance
    let mergeDistance = 10;
    for (let i = 0; i < points.length; i++) {
        for (let p = i + 1; p < points.length; p++) {
            if (getDistance(points[i], points[p]) < mergeDistance) {
                points[i].x = getMiddleValue(points[p].x, points[i].x);
                points[i].y = getMiddleValue(points[p].y, points[i].y);
                points.splice(p, 1);
                p--;
            }
        }
    }

    // Only use the left side, sort by extremes and find midpoint
    console.log(points[0])

    let sortedArray = [...points].sort((a, b) => a.x - b.x);

    let maxWidth = sortedArray[sortedArray.length - 1].x - sortedArray[0].x;
    let midpoint = maxWidth / 2 + sortedArray[0].x;

    let leftSidePoints = [];
    for (let i = 0; i < points.length; i++) {
        if (points[i].x < midpoint) {
            leftSidePoints.push(points[i]);
        }
    }
    leftSidePoints.sort((a, b) => a.y - b.y);

    console.log(points.length);
    console.log(leftSidePoints.length);

    // Three js part
    let scene = new THREE.Scene();
    scene.name = 'Vase';
    let material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    
    let nextY = leftSidePoints[leftSidePoints.length - 1].y;
    
    for (let i = 0; i < leftSidePoints.length - 1; i++) {
        let geometry = new THREE.CylinderGeometry(midpoint - leftSidePoints[i].x, midpoint - leftSidePoints[i + 1].x, leftSidePoints[i + 1].y - leftSidePoints[i].y, 32, 1, false);
        let cylinder = new THREE.Mesh(geometry, material);
        console.log('Offset: ' + nextY);
        console.log('Height: ' + (leftSidePoints[i + 1].y - leftSidePoints[i].y));

        cylinder.position.set(0, nextY, 0);
        nextY -= (leftSidePoints[i + 1].y - leftSidePoints[i].y);

        scene.add(cylinder);
    }

    const params = {
        trs: false,
        onlyVisible: true,
        binary: false,
        maxTextureSize: 4096
    };

    const options = {
        trs: params.trs,
        onlyVisible: params.onlyVisible,
        binary: params.binary,
        maxTextureSize: params.maxTextureSize
    };

    let exporter = new GLTFExporter();
    // Parse the input and generate the glTF output
    exporter.parse(
        scene,
        // called when the gltf has been generated
        function (gltf) {

            if (gltf instanceof ArrayBuffer) {

                console.error('Array error');

            } else {

                const output = JSON.stringify(gltf, null, 2);
                //console.log( output );
                saveString(output, 'scene.gltf');

            }

            //downloadJSON(gltf);
            //fs.writeFile(__dirname + '/vase.gltf', gltf);

        },
        // called when there is an error in the generation
        function (error) {

            console.log(error);

        },
        options
    );
}

function getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Returns middle of v1 and v2
function getMiddleValue(v1, v2) {
    return (v1 + v2) / 2;
}

function saveString(text, filename) {

    fs.writeFile(__dirname + '/temp/' + filename, text, function (err) {
        if (err) {
            return console.log(err);
        }
        console.log('File saved.');
    });

}