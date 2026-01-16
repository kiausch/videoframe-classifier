# Videoframe Classifier

Video frame extraction and image labeling tool for building training datasets.

## About

This tool was created out of necessity for the [smart cat door](https://github.com/kiausch/smart-catdoor) project, which uses computer vision to prevent cats from bringing prey inside. The project addresses a practical problem: efficiently labeling hundreds of video clips to train a ML model that recognizes when a cat is carrying prey.

Existing labeling solutions like Label-Studio proved cumbersome for this workflow, so a custom tool was built that streamlines:

- Batch extraction of frames from videos
- Rapid browsing and selection of images 
- Organization into labeled categories for training
- Dataset export with train/val splits

Built with [Vue 3](https://vuejs.org/), [Vuetify](https://vuetifyjs.com/), and [Neutralino.js](https://neutralino.js.org/).

![Screenshot](doc/screenshot.png)

## Features

- **Video Processing**: Extract frames from MP4, AVI, MOV, MKV, FLV, WMV, WebM (using ffmpeg)
- **Batch Operations**: Process multiple videos and label images in bulk
- **Keyboard Shortcuts**: Optimized workflow
- **Persistent Settings**: Auto-save workspace state
- **Dataset Export**: Create train/val splits with structured metadata

## Installation

Download pre-built binaries from [Releases](../../releases) for Windows, macOS, or Linux.

### Requirements

- **FFmpeg**: Required for video frame extraction. Install via:
  - **Windows**: `winget install ffmpeg` or download from [ffmpeg.org](https://ffmpeg.org/download.html)
  - **macOS**: `brew install ffmpeg`
  - **Linux**: `apt install ffmpeg` or equivalent for your distro

## Quick Start

1. Select video folder and output directory
2. Set frame extraction rate
3. Process videos to extract frames
4. Create labels for your categories
5. Label images from the gallery
6. Export dataset with train/val split

### Keyboard Shortcuts

- **Arrow Keys**: Navigate images
- **CTRL/Cmd + click**: add single image to selection
- **SHIFT + click**: add image range to selection
- **1-9**: Assign selected images to labels
- **Ctrl/Cmd + Z**: Undo
- **ESC**: close video preview / discard active image selection

## Dataset Format

```
output_folder/
├── project.json          # Labels and processed videos list
├── pool/                 # Extracted images to label
├── classes/              # Labeled images
│   ├── label_1/
│   └── ...
├── dataset/
│   ├── train/
│   │   ├── label_1/
│   │   │   ├── image_001.jpg
│   │   │   └── ...
│   │   └── label_2/
│   ├── val/
│   │   ├── label_1/
│   │   └── label_2/
│   └── dataset.yaml      # Generated during dataset creation
```

The `project.json` file stores:
- **labels**: Array of classification labels
- **processedVideos**: Array of full paths to videos already processed

Example `project.json`:
```json
{
  "labels": ["label_1", "label_2", "label_3"],
  "processedVideos": [
    "C:\\videos\\video1.mp4",
    "C:\\videos\\video2.mp4"
  ]
}
```

## Building from Source

Prerequisites: [Node.js](https://nodejs.org/)

```bash
npm install              # Install dependencies
npm run update           # Initialize neutralino binaries
npm run dev              # Run development server
npm run build            # Build production binaries with Neutralino
```

## Contributing

Part of the [smart cat door](https://github.com/kiausch/smart-catdoor) project. Contributions welcome via pull requests and issues.

## License

MIT
