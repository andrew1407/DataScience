# DataScience

A collection of Python data-science labs covering statistical data analysis, anomaly detection and signal cleaning, time-series forecasting, multi-criteria decision making, credit scoring, and computer-vision object detection. Each lab is a standalone folder with its own `main.py` entry point and `requirements.txt`.

## Labs

| Lab | Topic | Highlights |
| --- | --- | --- |
| [`1-lab`](1-lab/main.py) | Synthetic data analysis | Generates normal/exponential distributions and square/constant trends, composes them, and computes median, variance, and dispersion with histogram and dynamics plots. |
| [`2-lab`](2-lab/main.py) | Anomaly cleaning (least squares) | Injects abnormal noise into a trend, then detects and removes it with a least-squares (MNK) sliding-window detector; tunes detector parameters in parallel via a confusion-matrix/TPR score. |
| [`3-lab`](3-lab/main.py) | Anomaly cleaning (Kalman) | Cleans abnormal values using a second-order Kalman filter, outlier rejection, and an aging-based anomaly detector. |
| [`4-lab`](4-lab/main.py) | Multi-criteria decision making | Applies the Voronin integral-convolution method to rank route/product options read from an Excel table. |
| [`5-lab`](5-lab/main.py) | Time-series forecasting (XGBoost) | Fetches the OWID COVID-19 dataset, engineers date features, and forecasts new cases with an `XGBRegressor`, plotting predictions and feature importances. |
| [`6-lab`](6-lab/main.py) | Forecasting (MNK + neural net) | Uses the Jena climate dataset to extrapolate atmospheric pressure via least squares and predict it with a TensorFlow/Keras dense network. |
| [`7-lab`](7-lab/main.py) | Sales data analysis | Reads an Excel sales dataset and performs MNK flattening/extrapolation, rolling statistics, and segmentation/generalization by item and region. |
| [`8-lab`](8-lab/main.py) | Credit scoring pipeline | Cleans and normalizes loan applicant data, builds an integro score (Voronin), filters fraud via rule-based validation, smooths anomalies, and trains a Keras model to predict the score. |
| [`9-lab`](9-lab/main.py) | Computer vision (object detection) | Runs YOLOv3 weapon detection over input images with OpenCV's DNN module and non-maximum suppression, drawing bounding boxes. |
| [`control-work`](control-work/main.py) | Statistical analysis | Analyzes a normal distribution combined with a periodic (cosine) trend. |

## Tech stack

- Python (3.10+ syntax)
- NumPy, pandas
- Matplotlib, seaborn
- scikit-learn, SciPy
- XGBoost
- TensorFlow / Keras
- OpenCV (`opencv` DNN module, YOLOv3)
- requests, xlrd / openpyxl (Excel I/O)

Not every lab uses every library; see each lab's `requirements.txt` for its exact dependencies.

## Running

Each lab is independent. From a lab directory, install its dependencies and run its entry point:

```bash
cd 1-lab
pip install -r requirements.txt
python main.py
```

Notes on data inputs (these paths are git-ignored and must be supplied locally):

- [`4-lab`](4-lab/main.py) expects Excel tables under `tables/` (`routes.xls`, `Pr1.xls`).
- [`5-lab`](5-lab/main.py) and [`6-lab`](6-lab/main.py) download their datasets automatically (OWID COVID-19 CSV; Jena climate ZIP) and cache them locally.
- [`7-lab`](7-lab/main.py) expects `Data_Set_3.xls` in the lab directory.
- [`8-lab`](8-lab/main.py) reads Excel files from `input/` and writes results to `output/`.
- [`9-lab`](9-lab/main.py) expects images in `input/` and the YOLOv3 model files (`yolov3_training_2000.weights`, `yolov3_testing.cfg`) under `model/`.

## Project structure

```
.
├── 1-lab/          # synthetic distributions, trends, statistics
├── 2-lab/          # MNK sliding-window anomaly detection
├── 3-lab/          # Kalman-based anomaly cleaning
├── 4-lab/          # Voronin multi-criteria decision making
├── 5-lab/          # XGBoost COVID-19 forecasting
├── 6-lab/          # MNK + Keras climate forecasting
├── 7-lab/          # Excel sales analysis & segmentation
├── 8-lab/          # credit scoring pipeline
│   ├── datasamples/        # data formatting, loggers, utils
│   └── scoring_analysis/   # predictor, validation, anomalies, tools
├── 9-lab/          # YOLOv3 weapon detection (OpenCV)
└── control-work/   # normal distribution + periodic trend analysis
```
