/* Global state */
let neutralinoInitialized = false;

/* Vue 3 Application */
const { createApp } = Vue;

const app = createApp({
    data() {
        return {
            // Left Column - Video Selection
            selectedVideoFolder: null,
            videoFiles: [],
            selectedVideoFiles: [],
            processedVideoFiles: new Set(),
            currentVideo: null,
            currentVideoUrl: null,
            outputFolder: null,
            isPreprocessing: false,
            hideProcessedVideos: true,
            imageExtractionFramerate: 1,

            // Center Column - Image Gallery
            imageFiles: [],
            selectedImages: [],
            previewSize: 128,
            lastSelectedIndex: null,

            // Right Column - Label Assignment
            datasetLabels: [],
            datasetPath: null,
            isLabelEditorOpen: false,
            lastMoved: [], // for undo functionality
            labelStatistics: {},
            trainingSplit: 0.8,

            // UI State
            snackbar: {
                visible: false,
                message: '',
                color: 'info',
                timeout: 3000
            },

            // Statistics
            stats: {
                videoCount: 0,
                imageCount: 0,
                selectedImages: 0
            },

            // Constants
            VIDEO_EXTENSIONS: ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm'],
            IMAGE_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
        };
    },
    computed: {
        imageQueueFolder() {
            return this.outputFolder ? this.outputFolder + '/queue' : null;
        },
        canPreprocess() {
            return this.selectedVideoFolder && this.outputFolder && this.videoFiles.length > 0;
        },
        filteredVideoFiles() {
            if (this.hideProcessedVideos) {
                return this.videoFiles.filter(video => !this.processedVideoFiles.has(video));
            }
            return this.videoFiles;
        }
    },
    watch: {
        isLabelEditorOpen(newVal, oldVal) {
            // When closing the label editor, write changes to dataset.yaml
            if (newVal == false && oldVal == true) {
                this.writeDatasetYaml();
            }
        }
    },
    mounted() {
        this.initNeutralinoApp();
        this.setupKeyboardShortcuts();
        this.loadSettings();
    },
    methods: {
        /* ===== Initialization ===== */
        initNeutralinoApp() {
            if (!window.Neutralino) {
                this.showMessage('Neutralino framework not loaded', 'error');
                return;
            }

            Neutralino.init();
            neutralinoInitialized = true;

            Neutralino.events.on('windowClose', () => Neutralino.app.exit());
            Neutralino.events.on('serverOffline', () => {
                this.showMessage('Connection lost', 'error');
            });

            this.showMessage('Application ready', 'success');
        },

        async loadSettings() {
            try {
                this.selectedVideoFolder = await Neutralino.storage.getData('selectedVideoFolder');
                this.loadVideoFiles();
            } catch (error) {
                this.selectedVideoFolder = null;
            }
            try {
                this.outputFolder = await Neutralino.storage.getData('outputFolder');
                await this.loadImageFiles();
                await this.loadDatasetLabels();
                await this.loadProcessedVideoList();
                await this.updateLabelStatistics();
            }
            catch (error) {
                this.outputFolder = null;
            }
        },

        async mountFolder(folderPath, mountPoint) {
            try {
                // Unmount if already mounted
                try {
                    await Neutralino.server.unmount('/' + mountPoint);
                } catch (e) {
                    // Ignore if not mounted
                }

                // Mount the local folder to a server resource path
                await Neutralino.server.mount('/' + mountPoint, folderPath);
                return true;
            } catch (error) {
                console.error('Error mounting folder:', error);
                return false;
            }
        },

        getServerUrl(mountPoint, fileName) {
            // Construct URL using the mounted path
            return '/' + mountPoint + '/' + fileName;
        },

        setupKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                // 0-9 for label assignment
                if (e.key >= '0' && e.key <= '9') {
                    e.preventDefault();
                    const index = parseInt(e.key);
                    if (index < this.datasetLabels.length && this.selectedImages.length > 0) {
                        this.assignLabel(index);
                    }
                }
                // arrow keys to move selection
                else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (this.imageFiles.length === 0) return;

                    let newIndex = this.lastSelectedIndex || 0;
                    let numColumns = window.getComputedStyle(this.$refs.imageGallery)?.getPropertyValue('grid-template-columns')?.split(' ')?.length || 1;

                    if (e.key === 'ArrowRight') {
                        newIndex++;
                    } else if (e.key === 'ArrowLeft') {
                        newIndex--;
                    } else if (e.key === 'ArrowUp') {
                        newIndex -= numColumns;
                    } else if (e.key === 'ArrowDown') {
                        newIndex += numColumns;
                    }

                    if (newIndex < 0) newIndex = 0;
                    if (newIndex >= this.imageFiles.length) newIndex = this.imageFiles.length - 1;

                    const image = this.imageFiles[newIndex];
                    this.handleImageSelect(image, e);

                    // scroll into view
                    this.$nextTick(() => {
                        const imgElement = this.$refs.imageGallery.querySelectorAll('.gallery-item')[newIndex];
                        if (imgElement) {
                            imgElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                    });
                }
                else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    this.undoLastMove();
                }
                else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.currentVideo = null;
                    this.currentVideoUrl = null;
                    this.initImageSelection();
                }
            });
        },

        /* ===== File/Folder Selection ===== */
        async selectVideoFolder() {
            try {
                const folder = await Neutralino.os.showFolderDialog('Select Video Folder');
                if (folder) {
                    this.selectedVideoFolder = folder;
                    await this.loadVideoFiles();
                    this.showMessage('Video folder loaded', 'success');
                    await Neutralino.storage.setData('selectedVideoFolder', folder);
                }
            } catch (error) {
                this.showMessage('Error selecting folder: ' + error.message, 'error');
            }
        },

        async selectOutputFolder() {
            try {
                const folder = await Neutralino.os.showFolderDialog('Select Output Folder');
                if (folder) {
                    this.outputFolder = folder;
                    await this.loadImageFiles();
                    await this.loadDatasetLabels();
                    await this.loadProcessedVideoList();
                    this.showMessage('Output folder loaded', 'success');
                    await Neutralino.storage.setData('outputFolder', folder);
                    await this.updateLabelStatistics();
                }
            } catch (error) {
                this.showMessage('Error selecting folder: ' + error.message, 'error');
            }
        },

        async updateLabelStatistics() {
            this.labelStatistics = {};
            if (!this.outputFolder) return;
            for (const label of this.datasetLabels) {
                this.labelStatistics[label] = 0;
                const labelFolder = this.outputFolder + '/' + label;
                try {
                    const stats = await Neutralino.filesystem.getStats(labelFolder);
                    if (stats.isDirectory) {
                        const files = await Neutralino.filesystem.readDirectory(labelFolder);
                        this.labelStatistics[label] = files.filter(file => file.type === 'FILE').length;
                    }
                } catch (error) {
                    // Folder might not exist yet
                }
            }
        },

        /* ===== File Operations ===== */
        async loadVideoFiles() {
            try {
                if (!this.selectedVideoFolder) return;

                await this.mountFolder(this.selectedVideoFolder, 'videos');

                const files = await Neutralino.filesystem.readDirectory(this.selectedVideoFolder);
                this.videoFiles = files
                    .filter(file => {
                        if(file.type !== 'FILE') return false;
                        const fileName = file.entry;
                        const ext = '.' + fileName.split('.').pop().toLowerCase();
                        return this.VIDEO_EXTENSIONS.includes(ext) && !fileName.startsWith('.');
                    })
                    .map(file => file.entry)
                    .sort();

                this.stats.videoCount = this.videoFiles.length;
                this.currentVideo = null;
                this.currentVideoUrl = null;
            } catch (error) {
                this.showMessage('Error loading videos: ' + error.message, 'error');
            }
        },

        async loadImageFiles() {
            try {
                if (!this.imageQueueFolder) return;

                try {
                    await Neutralino.filesystem.getStats(this.imageQueueFolder);
                } catch (error) {
                    return;
                }
                
                await this.mountFolder(this.imageQueueFolder, 'images');
                const files = await Neutralino.filesystem.readDirectory(this.imageQueueFolder);
                this.imageFiles = files
                    .filter(file => {
                        if(file.type !== 'FILE') return false;
                        const fileName = file.entry;
                        const ext = '.' + fileName.split('.').pop().toLowerCase();
                        return this.IMAGE_EXTENSIONS.includes(ext) && !fileName.startsWith('.');
                    })
                    .map(file => file.entry)
                    .sort();

                this.stats.imageCount = this.imageFiles.length;
                this.initImageSelection();

            } catch (error) {
                this.showMessage('Error loading images: ' + error.message, 'error');
            }
        },

        initImageSelection() {
            if (this.imageFiles.length > 0) {
                this.selectedImages = [this.imageFiles[0]];
                this.lastSelectedIndex = 0;
            } else {
                this.selectedImages = [];
                this.lastSelectedIndex = null;
            }
            this.stats.selectedImages = this.selectedImages.length;
        },

        async loadDatasetLabels() {
            try {
                if (!this.outputFolder) return;

                const datasetPath = this.outputFolder + '/dataset.yaml';
                try {
                    const content = await Neutralino.filesystem.readFile(datasetPath);
                    this.parseDatasetYaml(content);
                    this.datasetPath = datasetPath;
                } catch (error) {
                    this.showMessage('No dataset.yaml found in folder', 'warning');
                    this.datasetLabels = [];
                }
            } catch (error) {
                this.showMessage('Error loading dataset: ' + error.message, 'error');
            }
        },

        parseDatasetYaml(content) {
            try {
                // Simple YAML parser for names field
                const namesMatch = content.match(/names:\s*\n([\s\S]*?)(?=\n[a-z]|\n$)/);
                if (!namesMatch) {
                    this.datasetLabels = [];
                    return;
                }

                const namesSection = namesMatch[1];

                // Extract id: name pairs
                const lines = namesSection.split('\n');
                for (const line of lines) {
                    const match = line.match(/^\s*(\d+):\s*(.+)$/);
                    if (match) {
                        this.datasetLabels.push(match[2].trim());
                    }
                }
            } catch (error) {
                this.showMessage('Error parsing dataset.yaml: ' + error.message, 'error');
            }
        },

        async writeDatasetYaml() {
            try {
                if (!this.outputFolder) return;
                const datasetPath = this.outputFolder + '/dataset.yaml';
                let content = 'names:\n';
                for (const [index, label] of this.datasetLabels.entries()) {
                    content += `  ${index}: ${label}\n`;
                }
                await Neutralino.filesystem.writeFile(datasetPath, content);
            } catch (error) {
                this.showMessage('Error writing dataset.yaml: ' + error.message, 'error');
            }
        },

        addNewLabel() {
            this.datasetLabels.push('new_label');
        },

        removeLabel(index) {
            this.datasetLabels.splice(index, 1);
        },

        async loadProcessedVideoList() {
            try {
                const processedPath = this.outputFolder + '/processed_videos.txt';
                const content = await Neutralino.filesystem.readFile(processedPath);
                const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                for (const line of lines) {
                    this.processedVideoFiles.add(line);
                }
            } catch (error) {
            }
        },

        async saveProcessedVideoList() {
            try {
                const processedPath = this.outputFolder + '/processed_videos.txt';
                const content = [...this.processedVideoFiles].join('\n');
                await Neutralino.filesystem.writeFile(processedPath, content);
            } catch (error) {
                this.showMessage('Error saving processed video list: ' + error.message, 'error');
            }
        },

        /* ===== Video Selection ===== */
        selectVideo(videoName) {
            this.currentVideo = videoName;
            this.currentVideoUrl = this.getServerUrl('videos', videoName);
        },
        toggleSelectedVideo(videoName) {
            const index = this.selectedVideoFiles.indexOf(videoName);
            if (index > -1) {
                this.selectedVideoFiles.splice(index, 1);
            } else {
                this.selectedVideoFiles.push(videoName);
            }
        },

        /* ===== Image Gallery ===== */
        getImageUrl(imageName) {
            if (!this.imageQueueFolder) return '';
            return this.getServerUrl('images', imageName);
        },

        handleImageSelect(image, event) {
            const index = this.imageFiles.indexOf(image);

            if (event.ctrlKey || event.metaKey || event.shiftKey) {
                if (event.shiftKey && this.lastSelectedIndex !== null) {
                    // Range select
                    const start = Math.min(this.lastSelectedIndex, index);
                    const end = Math.max(this.lastSelectedIndex, index);
                    for (let i = start; i <= end; i++) {
                        if (!this.selectedImages.includes(this.imageFiles[i])) {
                            this.selectedImages.push(this.imageFiles[i]);
                        }
                    }
                } else {
                    // Toggle select with Ctrl or meta
                    const pos = this.selectedImages.indexOf(image);
                    if (pos > -1) {
                        this.selectedImages.splice(pos, 1);
                    } else {
                        this.selectedImages.push(image);
                    }
                }
            } else {
                // Single select
                this.selectedImages = [image];
            }

            this.lastSelectedIndex = index;
            this.stats.selectedImages = this.selectedImages.length;
        },

        /* ===== Video Preprocessing ===== */
        async extractFramesFromVideos() {
            try {
                if (!this.selectedVideoFolder || !this.imageQueueFolder) {
                    this.showMessage('Select both video and process folders', 'warning');
                    return;
                }

                Neutralino.filesystem.createDirectory(this.imageQueueFolder).catch(() => {});

                this.isPreprocessing = true;
                let processedCount = 0;

                for (const video of this.selectedVideoFiles) {
                    try {
                        const videoPath = this.selectedVideoFolder + '/' + video;
                        const imageBaseName = video.split('.')[0];
                        const outputPattern = this.imageQueueFolder + '/' + imageBaseName + '_%05d.jpg';

                        // Build FFmpeg command
                        const command = `ffmpeg -i "${videoPath}" -vf fps=${this.imageExtractionFramerate} "${outputPattern}"`;

                        // Execute preprocessing
                        const result = await Neutralino.os.execCommand(command);
                        processedCount++;
                    } catch (error) {
                        this.showMessage(`Error processing ${video}: ` + error.message, 'warning');
                    }
                }

                // Reload images after preprocessing
                await this.loadImageFiles();
                this.isPreprocessing = false;
                this.showMessage(`Processed ${processedCount} video(s)`, 'success');
                while(processedVideo = this.selectedVideoFiles.pop()) {
                    this.processedVideoFiles.add(processedVideo);
                }
                await this.saveProcessedVideoList();
            } catch (error) {
                this.isPreprocessing = false;
                this.showMessage('Preprocessing error: ' + error.message, 'error');
            }
        },

        /* ===== Label Assignment ===== */
        async assignLabel(labelIndex) {
            try {
                if (!this.outputFolder || this.selectedImages.length === 0) {
                    this.showMessage('Select output folder and images', 'warning');
                    return;
                }

                if (labelIndex < 0 || labelIndex >= this.datasetLabels.length) {
                    this.showMessage('Invalid label index', 'warning');
                    return;
                }

                const label = this.datasetLabels[labelIndex];

                const labelFolder = this.outputFolder + '/' + label;

                // Create label folder if it doesn't exist
                try {
                    await Neutralino.filesystem.createDirectory(labelFolder);
                } catch (error) {
                    // Folder might already exist
                }

                let movedCount = 0;
                this.lastMoved = [];
                for (const image of this.selectedImages) {
                    try {
                        const sourcePath = this.imageQueueFolder + '/' + image;
                        const destPath = labelFolder + '/' + image;
                        await Neutralino.filesystem.move(sourcePath, destPath);
                        this.lastMoved.push({from: sourcePath, to: destPath});
                        movedCount++;
                        this.imageFiles.splice(this.imageFiles.indexOf(image), 1);
                    } catch (error) {
                        this.showMessage(`Error moving ${image}: ` + error.message, 'warning');
                    }
                }

                this.selectedImages = [];
                this.labelStatistics[label] += movedCount;
                this.showMessage(`Moved ${movedCount} image(s) to ${label}`, 'success');
            } catch (error) {
                this.showMessage('Error assigning label: ' + error.message, 'error');
            }
        },

        async undoLastMove() {
            try {
                if (this.lastMoved.length === 0) {
                    this.showMessage('No moves to undo', 'info');
                    return;
                }
                while (this.lastMoved.length > 0) {
                    const moved = this.lastMoved.pop();
                    await Neutralino.filesystem.move(moved.to, moved.from);
                }
                await this.loadImageFiles();
                await this.updateLabelStatistics();
            } catch (error) {
                this.showMessage('Error undoing move: ' + error.message, 'error');
            }
        },

        async createTrainingDataset() {
            function shuffle(array) {
                for(let index = array.length - 1; index > 0; index--) {
                    let randomIndex = Math.floor(Math.random() * (index + 1));
                    [array[index], array[randomIndex]] = [array[randomIndex], array[index]];
                }
                return array;   // note: the array is shuffled in place, return for ease of use
            }

            try {
                if (!this.outputFolder) {
                    this.showMessage('Select output folder first', 'warning');
                    return;
                }
                for (const label of this.datasetLabels) {
                    const labelFolder = this.outputFolder + '/' + label;
                    const trainFolder = this.outputFolder + '/train/' + label;
                    const valFolder = this.outputFolder + '/val/' + label;
                    try {
                        const stats = await Neutralino.filesystem.getStats(labelFolder);
                        if (stats.isDirectory) {
                            const files = await Neutralino.filesystem.readDirectory(labelFolder);
                            const imageFiles = shuffle(files.filter(file => file.type === 'FILE').map(file => file.entry));
                            const trainCount = Math.floor(imageFiles.length * this.trainingSplit);
                            await Neutralino.filesystem.createDirectory(trainFolder).catch(() => {});
                            await Neutralino.filesystem.createDirectory(valFolder).catch(() => {});
                            for (let i = 0; i < imageFiles.length; i++) {
                                const sourcePath = labelFolder + '/' + imageFiles[i];
                                const destPath = (i < trainCount ? trainFolder : valFolder) + '/' + imageFiles[i];
                                await Neutralino.filesystem.copy(sourcePath, destPath);
                            }
                        }
                    } catch (error) {
                        // Folder might not exist yet
                        this.showMessage('Error creating training dataset: ' + error.message, 'error');
                    }
                }
                this.showMessage('Training dataset created successfully', 'success');
            } catch (error) {
                this.showMessage('Error creating training dataset: ' + error.message, 'error');
            }
        },

        /* ===== Helper Methods ===== */
        getKeyboardShortcut(index) {
            return `${index}`;
        },

        showMessage(message, color = 'info') {
            this.snackbar.message = message;
            this.snackbar.color = color;
            this.snackbar.visible = true;
        }
    }
});

app.use(Vuetify.createVuetify());
app.mount('#app');
