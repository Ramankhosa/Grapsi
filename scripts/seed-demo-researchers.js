#!/usr/bin/env node

/**
 * Seed 50 demo researcher users at a given tenant with:
 *   - User accounts (password: DemoUser@2026)
 *   - ResearcherProfile rows (with research_summary, research_areas, keywords, institution info)
 *   - ResearcherSavedResearchArea rows (with taxonomy links)
 *   - Funding publications (reference_library rows tagged 'my-publication')
 *
 * Usage:
 *   node scripts/seed-demo-researchers.js                     # auto-picks the first non-platform tenant
 *   node scripts/seed-demo-researchers.js --tenant-id=<id>    # target a specific tenant
 *
 * After seeding, run the backfill to generate embeddings:
 *   curl -X POST $SITE_URL/api/admin/funding/embeddings/backfill \
 *        -H "Authorization: Bearer $TOKEN" \
 *        -H "Content-Type: application/json" \
 *        -d '{"target":"all","limit":100}'
 */

const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

const DEFAULT_PASSWORD = 'Password*77'

// ------------------------------------------------------------------
// LPU schools, departments, research areas
// ------------------------------------------------------------------

const LPU_RESEARCHERS = [
  // School of Computer Science & Engineering (10 researchers)
  {
    firstName: 'Arun', lastName: 'Sharma',
    department: 'Computer Science & Engineering', school: 'School of Computer Science & Engineering',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'My research focuses on deep learning architectures for natural language processing, with emphasis on transformer-based models for low-resource Indian languages. I have developed novel attention mechanisms that improve multilingual text understanding and have published extensively on cross-lingual transfer learning.',
    researchAreas: ['Deep Learning', 'Natural Language Processing', 'Multilingual AI'],
    keywords: ['transformer models', 'attention mechanism', 'cross-lingual NLP', 'Hindi NLP', 'BERT', 'language models'],
    publications: [
      { title: 'Cross-lingual Transfer Learning for Hindi Sentiment Analysis using Multilingual Transformers', year: 2024, venue: 'ACL Workshop on South Asian NLP' },
      { title: 'Efficient Attention Mechanisms for Low-Resource Language Understanding', year: 2023, venue: 'EMNLP Findings' }
    ]
  },
  {
    firstName: 'Priya', lastName: 'Gupta',
    department: 'Computer Science & Engineering', school: 'School of Computer Science & Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'I work on cybersecurity and blockchain technology with focus on securing IoT networks. My research develops lightweight cryptographic protocols for resource-constrained devices and explores consensus mechanisms for edge computing environments.',
    researchAreas: ['Cybersecurity', 'Blockchain Technology', 'Internet of Things Security'],
    keywords: ['IoT security', 'lightweight cryptography', 'blockchain consensus', 'edge computing', 'network security'],
    publications: [
      { title: 'Lightweight Blockchain Consensus for IoT Edge Networks: A Hybrid Approach', year: 2024, venue: 'IEEE Internet of Things Journal' },
      { title: 'Secure Data Aggregation in Smart Home IoT using Homomorphic Encryption', year: 2023, venue: 'Computers & Security' }
    ]
  },
  {
    firstName: 'Vikram', lastName: 'Singh',
    department: 'Computer Science & Engineering', school: 'School of Computer Science & Engineering',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research spans computer vision and medical image analysis. I develop deep learning models for automated disease detection from radiological images, with particular focus on tuberculosis and diabetic retinopathy screening using transfer learning and explainable AI.',
    researchAreas: ['Computer Vision', 'Medical Image Analysis', 'Explainable AI'],
    keywords: ['medical imaging', 'deep learning', 'TB detection', 'retinopathy', 'transfer learning', 'XAI', 'CNN'],
    publications: [
      { title: 'Explainable Deep Learning for Automated Tuberculosis Detection in Chest X-rays', year: 2025, venue: 'Medical Image Analysis' },
      { title: 'Multi-scale Feature Fusion for Diabetic Retinopathy Grading', year: 2024, venue: 'IEEE TBME' }
    ]
  },
  {
    firstName: 'Neha', lastName: 'Kapoor',
    department: 'Computer Science & Engineering', school: 'School of Computer Science & Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'I specialize in cloud computing and distributed systems with focus on serverless architectures and auto-scaling algorithms. My work addresses performance optimization of microservice-based applications and energy-efficient workload distribution in data centers.',
    researchAreas: ['Cloud Computing', 'Distributed Systems', 'Green Computing'],
    keywords: ['serverless', 'microservices', 'auto-scaling', 'Kubernetes', 'energy efficiency', 'data centers'],
    publications: [
      { title: 'Energy-Aware Workload Scheduling for Serverless Edge-Cloud Continuum', year: 2024, venue: 'IEEE Transactions on Cloud Computing' },
    ]
  },
  {
    firstName: 'Rajesh', lastName: 'Kumar',
    department: 'Computer Science & Engineering', school: 'School of Computer Science & Engineering',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'My research lies at the intersection of artificial intelligence and agriculture. I develop precision agriculture systems using drone imagery, satellite data, and machine learning for crop health monitoring, yield prediction, and pest detection in the Indian context.',
    researchAreas: ['Precision Agriculture', 'Remote Sensing', 'Machine Learning'],
    keywords: ['crop monitoring', 'drone imagery', 'NDVI', 'yield prediction', 'pest detection', 'satellite imagery', 'smart farming'],
    publications: [
      { title: 'Drone-based Multispectral Imaging for Wheat Disease Detection using Deep Learning', year: 2025, venue: 'Computers and Electronics in Agriculture' },
      { title: 'Satellite-derived Crop Yield Prediction for Punjab using Ensemble ML Models', year: 2024, venue: 'Remote Sensing of Environment' }
    ]
  },
  {
    firstName: 'Anita', lastName: 'Rani',
    department: 'Computer Science & Engineering', school: 'School of Computer Science & Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'I research data science and big data analytics applied to healthcare. My work involves building predictive models for patient outcomes, drug interaction prediction, and epidemiological modeling using real-world clinical data and federated learning.',
    researchAreas: ['Health Data Science', 'Big Data Analytics', 'Federated Learning'],
    keywords: ['healthcare analytics', 'clinical prediction', 'drug interaction', 'epidemiology', 'federated learning', 'EHR'],
    publications: [
      { title: 'Federated Learning for Distributed Clinical Outcome Prediction across Indian Hospitals', year: 2024, venue: 'Journal of Biomedical Informatics' },
    ]
  },
  {
    firstName: 'Manish', lastName: 'Thakur',
    department: 'Computer Science & Engineering', school: 'School of Computer Science & Engineering',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'My research focuses on software engineering and DevOps automation, particularly automated testing, CI/CD pipeline optimization, and code quality analysis using AI. I develop tools for automated code review and technical debt detection in large-scale software projects.',
    researchAreas: ['Software Engineering', 'DevOps', 'AI for Software Quality'],
    keywords: ['automated testing', 'CI/CD', 'code quality', 'technical debt', 'code review', 'static analysis'],
    publications: [
      { title: 'AI-assisted Technical Debt Detection and Prioritization in Microservice Architectures', year: 2024, venue: 'IEEE Software' },
    ]
  },
  {
    firstName: 'Shalini', lastName: 'Verma',
    department: 'Computer Science & Engineering', school: 'School of Computer Science & Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'I work on reinforcement learning and robotics with applications in autonomous navigation. My research develops safe RL algorithms for indoor robot navigation and human-robot collaboration in warehouse and manufacturing settings.',
    researchAreas: ['Reinforcement Learning', 'Robotics', 'Autonomous Navigation'],
    keywords: ['safe RL', 'robot navigation', 'human-robot interaction', 'warehouse robots', 'path planning', 'sim-to-real'],
    publications: [
      { title: 'Safe Reinforcement Learning for Indoor Robot Navigation with Human Awareness', year: 2025, venue: 'IEEE Robotics and Automation Letters' },
    ]
  },
  {
    firstName: 'Deepak', lastName: 'Mishra',
    department: 'Artificial Intelligence', school: 'School of Computer Science & Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'My research centers on generative AI and large language models, specifically their application in education. I develop AI tutoring systems, automated question generation, and adaptive learning platforms tailored for Indian higher education.',
    researchAreas: ['Generative AI', 'AI in Education', 'Adaptive Learning'],
    keywords: ['LLMs', 'ChatGPT', 'AI tutor', 'question generation', 'adaptive learning', 'educational technology'],
    publications: [
      { title: 'Adaptive AI Tutoring using Large Language Models for Undergraduate Engineering Education', year: 2025, venue: 'Computers & Education' },
    ]
  },
  {
    firstName: 'Kavita', lastName: 'Joshi',
    department: 'Data Science', school: 'School of Computer Science & Engineering',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I specialize in graph neural networks and knowledge graphs for recommendation systems. My work develops heterogeneous graph-based models for personalized recommendations in e-commerce and social media platforms, with focus on cold-start and fairness problems.',
    researchAreas: ['Graph Neural Networks', 'Knowledge Graphs', 'Recommendation Systems'],
    keywords: ['GNN', 'knowledge graph', 'recommender system', 'cold-start', 'fairness in ML', 'heterogeneous graphs'],
    publications: [
      { title: 'Fair Knowledge Graph-enhanced Recommendations for Cold-start Users', year: 2024, venue: 'RecSys' },
      { title: 'Heterogeneous Graph Attention Networks for Social E-commerce Recommendations', year: 2023, venue: 'WWW' }
    ]
  },

  // School of Electronics & Electrical Engineering (8 researchers)
  {
    firstName: 'Suresh', lastName: 'Patel',
    department: 'Electronics & Communication Engineering', school: 'School of Electronics & Electrical Engineering',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research focuses on 5G/6G wireless communications and antenna design. I develop MIMO antenna systems, beamforming algorithms, and millimeter-wave propagation models for next-generation cellular networks, with emphasis on rural connectivity in India.',
    researchAreas: ['5G/6G Communications', 'Antenna Design', 'MIMO Systems'],
    keywords: ['5G', '6G', 'MIMO', 'beamforming', 'mmWave', 'antenna', 'rural connectivity'],
    publications: [
      { title: 'Compact MIMO Antenna Design for Sub-6 GHz 5G Rural Base Stations', year: 2024, venue: 'IEEE TAP' },
      { title: 'Hybrid Beamforming for mmWave 5G in Dense Urban Indian Deployments', year: 2023, venue: 'IEEE TWC' }
    ]
  },
  {
    firstName: 'Ritu', lastName: 'Devi',
    department: 'Electrical Engineering', school: 'School of Electronics & Electrical Engineering',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I research renewable energy systems and smart grid technologies. My work focuses on solar PV integration, battery management systems, and demand response algorithms for Indian distribution networks. I also work on energy storage optimization for microgrids.',
    researchAreas: ['Renewable Energy', 'Smart Grid', 'Energy Storage'],
    keywords: ['solar PV', 'battery management', 'microgrid', 'demand response', 'smart grid', 'energy storage'],
    publications: [
      { title: 'Optimal Battery Management for Solar Microgrid Systems in Rural India', year: 2024, venue: 'Applied Energy' },
    ]
  },
  {
    firstName: 'Amit', lastName: 'Chauhan',
    department: 'Electronics & Communication Engineering', school: 'School of Electronics & Electrical Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'My research focuses on VLSI design and embedded systems for biomedical applications. I develop low-power ASIC designs for wearable health monitoring devices, including ECG signal processing and arrhythmia detection circuits.',
    researchAreas: ['VLSI Design', 'Biomedical Electronics', 'Wearable Sensors'],
    keywords: ['ASIC', 'low-power design', 'ECG', 'wearable', 'arrhythmia detection', 'embedded systems'],
    publications: [
      { title: 'Ultra-low Power ASIC for Real-time ECG Arrhythmia Classification in Wearables', year: 2025, venue: 'IEEE JSSC' },
    ]
  },
  {
    firstName: 'Pooja', lastName: 'Mehta',
    department: 'Electronics & Communication Engineering', school: 'School of Electronics & Electrical Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'I work on signal processing and speech recognition for Indian languages. My research develops robust speech-to-text systems for noisy environments, speaker diarization, and emotion recognition from speech signals for regional Indian languages.',
    researchAreas: ['Speech Processing', 'Signal Processing', 'Emotion Recognition'],
    keywords: ['speech recognition', 'speaker diarization', 'emotion detection', 'Indian languages', 'noise-robust ASR'],
    publications: [
      { title: 'Noise-robust Speech Recognition for Punjabi using Self-supervised Pre-training', year: 2024, venue: 'Speech Communication' },
    ]
  },
  {
    firstName: 'Gaurav', lastName: 'Bansal',
    department: 'Electrical Engineering', school: 'School of Electronics & Electrical Engineering',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'My research centers on electric vehicle technology and power electronics. I develop advanced motor drives, battery charging systems, and vehicle-to-grid integration strategies for the growing Indian EV ecosystem.',
    researchAreas: ['Electric Vehicles', 'Power Electronics', 'Vehicle-to-Grid'],
    keywords: ['EV', 'motor drive', 'battery charging', 'V2G', 'power converter', 'SiC devices'],
    publications: [
      { title: 'Bidirectional V2G Charging with SiC-based Converters for Indian Smart Grids', year: 2025, venue: 'IEEE Transactions on Power Electronics' },
    ]
  },
  {
    firstName: 'Sunita', lastName: 'Rawat',
    department: 'Electronics & Communication Engineering', school: 'School of Electronics & Electrical Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'I research image and video compression using deep learning. My work develops neural codec architectures for efficient video streaming at low bandwidths, targeting mobile users in developing regions.',
    researchAreas: ['Video Compression', 'Deep Learning', 'Multimedia Systems'],
    keywords: ['neural codec', 'video compression', 'deep learning', 'streaming', 'low bandwidth', 'mobile video'],
    publications: [
      { title: 'Lightweight Neural Video Codec for Low-bandwidth Mobile Streaming', year: 2024, venue: 'IEEE TCSVT' },
    ]
  },
  {
    firstName: 'Harish', lastName: 'Negi',
    department: 'Electronics & Communication Engineering', school: 'School of Electronics & Electrical Engineering',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research involves optical fiber communications and photonics. I develop advanced modulation formats and digital signal processing techniques for long-haul fiber optic transmission systems, working on coherent detection and space-division multiplexing.',
    researchAreas: ['Optical Communications', 'Photonics', 'Digital Signal Processing'],
    keywords: ['optical fiber', 'coherent detection', 'SDM', 'DSP', 'modulation', 'photonics'],
    publications: [
      { title: 'Space-Division Multiplexing with Adaptive DSP for Long-haul Fiber Links', year: 2024, venue: 'Journal of Lightwave Technology' },
    ]
  },
  {
    firstName: 'Meena', lastName: 'Agarwal',
    department: 'Electrical Engineering', school: 'School of Electronics & Electrical Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'I work on control systems and automation for industrial processes. My research develops model predictive control algorithms and digital twin technology for process optimization in chemical and pharmaceutical manufacturing.',
    researchAreas: ['Control Systems', 'Digital Twins', 'Process Automation'],
    keywords: ['MPC', 'digital twin', 'process control', 'automation', 'Industry 4.0', 'pharmaceutical'],
    publications: [
      { title: 'Digital Twin-based Model Predictive Control for Pharmaceutical Batch Processes', year: 2024, venue: 'Control Engineering Practice' },
    ]
  },

  // School of Mechanical Engineering (7 researchers)
  {
    firstName: 'Rohit', lastName: 'Bhatia',
    department: 'Mechanical Engineering', school: 'School of Mechanical Engineering',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research focuses on advanced manufacturing and additive manufacturing (3D printing). I develop novel metal 3D printing processes using laser powder bed fusion, studying microstructure evolution, residual stress, and mechanical properties of printed aerospace components.',
    researchAreas: ['Additive Manufacturing', 'Advanced Manufacturing', 'Materials Science'],
    keywords: ['3D printing', 'LPBF', 'metal AM', 'aerospace', 'microstructure', 'residual stress', 'titanium alloys'],
    publications: [
      { title: 'Microstructure-Property Relationships in LPBF Ti-6Al-4V for Aerospace Applications', year: 2025, venue: 'Additive Manufacturing' },
      { title: 'Residual Stress Prediction in Metal 3D Printing using Physics-informed Neural Networks', year: 2024, venue: 'Journal of Manufacturing Processes' }
    ]
  },
  {
    firstName: 'Sapna', lastName: 'Yadav',
    department: 'Mechanical Engineering', school: 'School of Mechanical Engineering',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I research computational fluid dynamics and heat transfer with applications in thermal management of electronics and HVAC systems. My work develops numerical models for phase change cooling and optimizes heat sink designs using topology optimization.',
    researchAreas: ['Computational Fluid Dynamics', 'Heat Transfer', 'Thermal Management'],
    keywords: ['CFD', 'heat transfer', 'phase change', 'heat sink', 'topology optimization', 'electronics cooling'],
    publications: [
      { title: 'Topology-optimized Heat Sinks for High-power LED Thermal Management', year: 2024, venue: 'Applied Thermal Engineering' },
    ]
  },
  {
    firstName: 'Karan', lastName: 'Malhotra',
    department: 'Mechanical Engineering', school: 'School of Mechanical Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'My research area is sustainable materials and composites. I develop bio-based composite materials from agricultural waste (rice husk, wheat straw) for automotive and construction applications, focusing on mechanical characterization and life cycle assessment.',
    researchAreas: ['Sustainable Materials', 'Composite Materials', 'Circular Economy'],
    keywords: ['bio-composites', 'agricultural waste', 'rice husk', 'natural fibers', 'LCA', 'green materials'],
    publications: [
      { title: 'Rice Husk-Epoxy Biocomposites for Automotive Interior Panels: Mechanical and Thermal Properties', year: 2024, venue: 'Composites Part B' },
    ]
  },
  {
    firstName: 'Divya', lastName: 'Kohli',
    department: 'Mechanical Engineering', school: 'School of Mechanical Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'I work on robotics and mechatronics with focus on soft robotics and bio-inspired actuators. My research develops pneumatic soft grippers for agricultural harvesting and food processing, using computational design and 3D-printed silicone structures.',
    researchAreas: ['Soft Robotics', 'Mechatronics', 'Bio-inspired Design'],
    keywords: ['soft gripper', 'pneumatic actuator', 'agricultural robot', 'bio-inspired', 'silicone 3D printing'],
    publications: [
      { title: 'Pneumatic Soft Gripper for Delicate Fruit Harvesting: Design and Field Trials', year: 2025, venue: 'Soft Robotics' },
    ]
  },
  {
    firstName: 'Pankaj', lastName: 'Dhiman',
    department: 'Mechanical Engineering', school: 'School of Mechanical Engineering',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research involves tribology and surface engineering. I study wear and friction behavior of engineered surfaces, develop surface coating technologies using plasma spray and PVD, and work on lubrication strategies for high-performance mechanical systems.',
    researchAreas: ['Tribology', 'Surface Engineering', 'Coatings'],
    keywords: ['wear', 'friction', 'surface coating', 'plasma spray', 'PVD', 'lubrication', 'surface texture'],
    publications: [
      { title: 'Wear-resistant TiAlN Coatings by Cathodic Arc PVD for Cutting Tool Applications', year: 2024, venue: 'Surface and Coatings Technology' },
    ]
  },
  {
    firstName: 'Nidhi', lastName: 'Saini',
    department: 'Mechanical Engineering', school: 'School of Mechanical Engineering',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I research energy harvesting and vibration analysis. My work develops piezoelectric energy harvesters for powering IoT sensors in structural health monitoring systems, using finite element modeling and experimental validation.',
    researchAreas: ['Energy Harvesting', 'Vibration Analysis', 'Structural Health Monitoring'],
    keywords: ['piezoelectric', 'energy harvester', 'SHM', 'vibration', 'IoT sensor', 'FEM'],
    publications: [
      { title: 'Broadband Piezoelectric Energy Harvester for Bridge Structural Health Monitoring', year: 2024, venue: 'Smart Materials and Structures' },
    ]
  },
  {
    firstName: 'Tarun', lastName: 'Gill',
    department: 'Aerospace Engineering', school: 'School of Mechanical Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'My research focuses on UAV aerodynamics and design. I develop fixed-wing UAV platforms for agricultural spraying and disaster monitoring, using CFD analysis and wind tunnel testing to optimize aerodynamic performance and payload capacity.',
    researchAreas: ['UAV Design', 'Aerodynamics', 'Agricultural Aviation'],
    keywords: ['UAV', 'drone', 'aerodynamics', 'CFD', 'wind tunnel', 'agricultural spraying', 'disaster monitoring'],
    publications: [
      { title: 'Aerodynamic Optimization of Fixed-wing Agricultural Spray UAV for Indian Farming', year: 2025, venue: 'Aerospace Science and Technology' },
    ]
  },

  // School of Civil Engineering (5 researchers)
  {
    firstName: 'Ashok', lastName: 'Rathore',
    department: 'Civil Engineering', school: 'School of Civil Engineering',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research focuses on earthquake engineering and structural dynamics. I develop seismic-resistant design methodologies for reinforced concrete structures, base isolation systems, and performance-based earthquake engineering for Indian building codes.',
    researchAreas: ['Earthquake Engineering', 'Structural Dynamics', 'Seismic Design'],
    keywords: ['seismic design', 'base isolation', 'RC structures', 'earthquake', 'performance-based design', 'Indian codes'],
    publications: [
      { title: 'Performance-based Seismic Design of Multi-story RC Buildings in High Seismic Zones of India', year: 2024, venue: 'Earthquake Engineering & Structural Dynamics' },
    ]
  },
  {
    firstName: 'Geeta', lastName: 'Tiwari',
    department: 'Civil Engineering', school: 'School of Civil Engineering',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I research water resources engineering and hydrology. My work involves developing flood prediction models using machine learning, designing sustainable urban drainage systems, and analyzing groundwater depletion patterns in north-western India using remote sensing.',
    researchAreas: ['Water Resources Engineering', 'Hydrology', 'Flood Prediction'],
    keywords: ['flood prediction', 'urban drainage', 'groundwater', 'ML hydrology', 'remote sensing', 'water management'],
    publications: [
      { title: 'Machine Learning Ensemble for Real-time Flood Prediction in Punjab River Basins', year: 2025, venue: 'Journal of Hydrology' },
    ]
  },
  {
    firstName: 'Lalit', lastName: 'Goyal',
    department: 'Civil Engineering', school: 'School of Civil Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'My research area is sustainable construction materials. I develop green concrete using industrial by-products (fly ash, GGBS, silica fume), study the durability of geopolymer concrete, and investigate self-healing concrete technologies for extending infrastructure lifespan.',
    researchAreas: ['Sustainable Construction', 'Green Concrete', 'Geopolymer Technology'],
    keywords: ['green concrete', 'fly ash', 'geopolymer', 'self-healing concrete', 'GGBS', 'durability'],
    publications: [
      { title: 'Self-healing Geopolymer Concrete with Bacteria-based Healing Agents: Durability Study', year: 2024, venue: 'Cement and Concrete Composites' },
    ]
  },
  {
    firstName: 'Rekha', lastName: 'Chaudhary',
    department: 'Environmental Engineering', school: 'School of Civil Engineering',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I work on environmental engineering and air quality management. My research develops low-cost air quality sensor networks, atmospheric dispersion models for Indian cities, and phytoremediation technologies for industrial wastewater treatment.',
    researchAreas: ['Environmental Engineering', 'Air Quality', 'Wastewater Treatment'],
    keywords: ['air quality', 'sensor network', 'dispersion model', 'phytoremediation', 'wastewater', 'pollution'],
    publications: [
      { title: 'Low-cost IoT Sensor Network for Real-time Air Quality Monitoring in Indian Cities', year: 2024, venue: 'Environmental Monitoring and Assessment' },
    ]
  },
  {
    firstName: 'Ajay', lastName: 'Sood',
    department: 'Civil Engineering', school: 'School of Civil Engineering',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'My research focuses on geotechnical engineering and soil mechanics. I study soil stabilization using nanomaterials, develop foundation design methods for expansive soils, and work on slope stability analysis using AI-driven geotechnical models.',
    researchAreas: ['Geotechnical Engineering', 'Soil Stabilization', 'Foundation Engineering'],
    keywords: ['soil stabilization', 'nanomaterials', 'expansive soil', 'slope stability', 'foundation design', 'AI geotechnics'],
    publications: [
      { title: 'Nano-silica Stabilization of Expansive Clay Soils: Micro-macro Analysis', year: 2025, venue: 'Geotechnique' },
    ]
  },

  // School of Bioengineering & Biosciences (5 researchers)
  {
    firstName: 'Smita', lastName: 'Pandey',
    department: 'Biotechnology', school: 'School of Bioengineering & Biosciences',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research focuses on plant biotechnology and genomics. I develop transgenic crop varieties with enhanced stress tolerance, study epigenetic regulation of drought response in wheat, and work on CRISPR-based genome editing for crop improvement.',
    researchAreas: ['Plant Biotechnology', 'Genomics', 'CRISPR Gene Editing'],
    keywords: ['CRISPR', 'plant genomics', 'drought tolerance', 'wheat', 'epigenetics', 'transgenic crops'],
    publications: [
      { title: 'CRISPR-Cas9 Mediated Drought Tolerance Enhancement in Indian Wheat Varieties', year: 2025, venue: 'Plant Biotechnology Journal' },
      { title: 'Epigenetic Regulation of Abiotic Stress Response in Triticum aestivum', year: 2024, venue: 'Plant Cell' }
    ]
  },
  {
    firstName: 'Varun', lastName: 'Sethi',
    department: 'Microbiology', school: 'School of Bioengineering & Biosciences',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I research antimicrobial resistance and novel drug discovery. My work involves screening soil microbiomes for novel antibiotic-producing organisms, developing nanoparticle-based drug delivery for resistant infections, and studying horizontal gene transfer of resistance.',
    researchAreas: ['Antimicrobial Resistance', 'Drug Discovery', 'Microbial Genomics'],
    keywords: ['AMR', 'antibiotic resistance', 'drug discovery', 'soil microbiome', 'nanoparticle drug delivery', 'HGT'],
    publications: [
      { title: 'Novel Antimicrobial Peptides from Punjab Soil Actinomycetes against MRSA', year: 2024, venue: 'Nature Microbiology' },
    ]
  },
  {
    firstName: 'Pallavi', lastName: 'Bhatt',
    department: 'Biomedical Engineering', school: 'School of Bioengineering & Biosciences',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'My research spans tissue engineering and regenerative medicine. I develop biodegradable scaffolds using electrospinning for bone and cartilage regeneration, and work on 3D bioprinting of vascularized tissue constructs.',
    researchAreas: ['Tissue Engineering', 'Regenerative Medicine', '3D Bioprinting'],
    keywords: ['scaffolds', 'electrospinning', 'bone regeneration', 'bioprinting', 'biomaterials', 'cartilage'],
    publications: [
      { title: 'Electrospun PCL/Hydroxyapatite Scaffolds for Bone Tissue Regeneration', year: 2024, venue: 'Biomaterials' },
    ]
  },
  {
    firstName: 'Nitin', lastName: 'Arora',
    department: 'Food Technology', school: 'School of Bioengineering & Biosciences',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I work on food science and nutrition with focus on food safety and processing. My research develops rapid detection methods for food-borne pathogens using biosensors, studies the nutritional impact of food processing methods, and works on functional food development.',
    researchAreas: ['Food Science', 'Food Safety', 'Functional Foods'],
    keywords: ['food safety', 'biosensor', 'pathogen detection', 'food processing', 'nutraceuticals', 'functional food'],
    publications: [
      { title: 'Aptamer-based Biosensor for Rapid Detection of Salmonella in Dairy Products', year: 2025, venue: 'Food Chemistry' },
    ]
  },
  {
    firstName: 'Isha', lastName: 'Saxena',
    department: 'Biochemistry', school: 'School of Bioengineering & Biosciences',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'My research focuses on cancer biology and targeted therapeutics. I study molecular pathways of breast cancer progression in Indian populations, develop targeted nanocarrier drug delivery systems, and investigate novel biomarkers for early cancer diagnosis.',
    researchAreas: ['Cancer Biology', 'Targeted Therapeutics', 'Nanomedicine'],
    keywords: ['breast cancer', 'targeted therapy', 'nanocarrier', 'biomarker', 'molecular oncology', 'drug delivery'],
    publications: [
      { title: 'pH-responsive Nanocarriers for Targeted Doxorubicin Delivery in Triple-negative Breast Cancer', year: 2024, venue: 'ACS Nano' },
    ]
  },

  // School of Chemical Engineering (3 researchers)
  {
    firstName: 'Anand', lastName: 'Prakash',
    department: 'Chemical Engineering', school: 'School of Chemical Engineering & Physical Sciences',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research involves catalysis and reaction engineering for sustainable chemistry. I develop heterogeneous catalysts for biomass conversion to biofuels, CO2 capture and utilization, and green hydrogen production via electrocatalysis.',
    researchAreas: ['Catalysis', 'Green Chemistry', 'Biofuels'],
    keywords: ['heterogeneous catalysis', 'biomass conversion', 'CO2 capture', 'green hydrogen', 'biofuel', 'electrocatalysis'],
    publications: [
      { title: 'Bifunctional Catalysts for Direct CO2 Hydrogenation to Methanol', year: 2025, venue: 'ACS Catalysis' },
      { title: 'Lignocellulosic Biomass Conversion over Hierarchical Zeolite Catalysts', year: 2024, venue: 'Green Chemistry' }
    ]
  },
  {
    firstName: 'Bhavna', lastName: 'Rana',
    department: 'Chemical Engineering', school: 'School of Chemical Engineering & Physical Sciences',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I research membrane technology and separation processes. My work develops advanced polymeric and ceramic membranes for water purification, desalination, and industrial effluent treatment, with focus on anti-fouling strategies and membrane surface modification.',
    researchAreas: ['Membrane Technology', 'Water Purification', 'Separation Processes'],
    keywords: ['membrane', 'desalination', 'water purification', 'anti-fouling', 'ceramic membrane', 'effluent treatment'],
    publications: [
      { title: 'Anti-fouling Graphene Oxide-modified Ceramic Membranes for Textile Effluent Treatment', year: 2024, venue: 'Journal of Membrane Science' },
    ]
  },
  {
    firstName: 'Gopal', lastName: 'Taneja',
    department: 'Physics', school: 'School of Chemical Engineering & Physical Sciences',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'My research lies in condensed matter physics and nanomaterials. I study quantum dots and 2D materials for optoelectronic applications, develop perovskite solar cells, and investigate magnetic nanostructures for spintronic devices.',
    researchAreas: ['Nanomaterials', 'Perovskite Solar Cells', 'Spintronics'],
    keywords: ['quantum dots', '2D materials', 'perovskite', 'solar cell', 'spintronics', 'magnetic nanostructures'],
    publications: [
      { title: 'High-efficiency Lead-free Perovskite Solar Cells using Sn-Ge Alloy Absorbers', year: 2025, venue: 'Nature Energy' },
    ]
  },

  // School of Pharmaceutical Sciences (4 researchers)
  {
    firstName: 'Monika', lastName: 'Sharma',
    department: 'Pharmaceutical Sciences', school: 'School of Pharmaceutical Sciences',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research focuses on pharmaceutical nanotechnology and drug delivery systems. I develop lipid nanoparticle formulations for mRNA vaccine delivery, design stimuli-responsive hydrogels for sustained drug release, and work on topical formulations for dermatological conditions.',
    researchAreas: ['Pharmaceutical Nanotechnology', 'Drug Delivery', 'Vaccine Formulation'],
    keywords: ['lipid nanoparticle', 'mRNA delivery', 'hydrogel', 'drug delivery', 'vaccine', 'dermatology'],
    publications: [
      { title: 'Ionizable Lipid Nanoparticles for mRNA Vaccine Delivery: Optimization and Stability', year: 2025, venue: 'Journal of Controlled Release' },
      { title: 'Temperature-responsive Hydrogels for Sustained Ocular Drug Delivery', year: 2024, venue: 'European Journal of Pharmaceutics and Biopharmaceutics' }
    ]
  },
  {
    firstName: 'Vivek', lastName: 'Garg',
    department: 'Pharmacology', school: 'School of Pharmaceutical Sciences',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I research neuropharmacology and neurodegenerative diseases. My work focuses on understanding molecular mechanisms of Alzheimer\'s disease, developing neuroprotective compounds from Indian medicinal plants, and repurposing existing drugs for neurological conditions.',
    researchAreas: ['Neuropharmacology', 'Alzheimer\'s Disease', 'Herbal Medicine'],
    keywords: ['neurodegeneration', 'Alzheimers', 'neuroprotection', 'drug repurposing', 'medicinal plants', 'Ayurveda'],
    publications: [
      { title: 'Neuroprotective Potential of Bacopa monnieri Extract in Amyloid-β Induced Neurotoxicity', year: 2024, venue: 'Journal of Ethnopharmacology' },
    ]
  },
  {
    firstName: 'Swati', lastName: 'Khurana',
    department: 'Pharmaceutical Chemistry', school: 'School of Pharmaceutical Sciences',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'My research involves computational drug design and medicinal chemistry. I use molecular docking, MD simulations, and AI-based drug design to develop novel inhibitors for tropical disease targets, particularly dengue and malaria drug targets.',
    researchAreas: ['Computational Drug Design', 'Medicinal Chemistry', 'Tropical Diseases'],
    keywords: ['molecular docking', 'MD simulation', 'AI drug design', 'dengue', 'malaria', 'medicinal chemistry'],
    publications: [
      { title: 'AI-driven Identification of Novel NS5 Inhibitors for Dengue Virus', year: 2025, venue: 'Journal of Medicinal Chemistry' },
    ]
  },
  {
    firstName: 'Rahul', lastName: 'Chhabra',
    department: 'Pharmaceutical Sciences', school: 'School of Pharmaceutical Sciences',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'I work on pharmacogenomics and personalized medicine. My research studies genetic polymorphisms affecting drug metabolism in Indian populations, develops pharmacogenomic testing panels, and investigates dosing optimization strategies for precision therapeutics.',
    researchAreas: ['Pharmacogenomics', 'Personalized Medicine', 'Clinical Pharmacology'],
    keywords: ['pharmacogenomics', 'precision medicine', 'drug metabolism', 'genetic polymorphism', 'CYP450', 'dosing'],
    publications: [
      { title: 'CYP2D6 Polymorphisms and Antidepressant Response in North Indian Populations', year: 2024, venue: 'Pharmacogenomics Journal' },
    ]
  },

  // School of Agriculture (4 researchers)
  {
    firstName: 'Jagdish', lastName: 'Chand',
    department: 'Agriculture', school: 'School of Agriculture',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research focuses on crop science and breeding. I develop high-yielding, disease-resistant wheat and rice varieties for north-western India using marker-assisted selection and genomic selection approaches.',
    researchAreas: ['Crop Breeding', 'Plant Genetics', 'Genomic Selection'],
    keywords: ['wheat breeding', 'rice breeding', 'MAS', 'genomic selection', 'disease resistance', 'yield improvement'],
    publications: [
      { title: 'Genomic Selection for Grain Yield and Rust Resistance in Indian Bread Wheat', year: 2025, venue: 'Theoretical and Applied Genetics' },
    ]
  },
  {
    firstName: 'Kamini', lastName: 'Dutta',
    department: 'Agriculture', school: 'School of Agriculture',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I research soil science and sustainable agriculture. My work develops biofertilizer technologies using plant growth-promoting rhizobacteria, studies soil carbon sequestration under conservation agriculture, and investigates microplastic contamination in agricultural soils.',
    researchAreas: ['Soil Science', 'Sustainable Agriculture', 'Biofertilizers'],
    keywords: ['biofertilizer', 'PGPR', 'soil carbon', 'conservation agriculture', 'microplastic', 'soil health'],
    publications: [
      { title: 'Consortium Biofertilizer from PGPR for Sustainable Wheat Production in Indo-Gangetic Plains', year: 2024, venue: 'Applied Soil Ecology' },
    ]
  },
  {
    firstName: 'Sanjeev', lastName: 'Pal',
    department: 'Horticulture', school: 'School of Agriculture',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'My research focuses on post-harvest technology and food quality. I develop cold chain management solutions for fruits and vegetables, study modified atmosphere packaging for extending shelf life, and work on non-destructive quality assessment using hyperspectral imaging.',
    researchAreas: ['Post-harvest Technology', 'Food Quality', 'Cold Chain Management'],
    keywords: ['post-harvest', 'cold chain', 'MAP', 'hyperspectral imaging', 'shelf life', 'fruit quality'],
    publications: [
      { title: 'Hyperspectral Imaging for Non-destructive Quality Assessment of Mangoes during Cold Storage', year: 2025, venue: 'Postharvest Biology and Technology' },
    ]
  },
  {
    firstName: 'Usha', lastName: 'Bisht',
    department: 'Agriculture', school: 'School of Agriculture',
    careerStage: 'ASSISTANT_PROFESSOR',
    researchSummary: 'I work on agricultural entomology and integrated pest management. My research develops biological control strategies using parasitoids and predators, studies insecticide resistance mechanisms, and creates IPM protocols for cotton and paddy in Punjab.',
    researchAreas: ['Entomology', 'Integrated Pest Management', 'Biological Control'],
    keywords: ['IPM', 'biological control', 'parasitoid', 'insecticide resistance', 'cotton pest', 'paddy pest'],
    publications: [
      { title: 'Integrated Pest Management Protocol for Bollworm Control in Bt Cotton Fields of Punjab', year: 2024, venue: 'Crop Protection' },
    ]
  },

  // School of Business (2 researchers)
  {
    firstName: 'Sanjay', lastName: 'Mittal',
    department: 'Management', school: 'School of Business',
    careerStage: 'PROFESSOR',
    researchSummary: 'My research focuses on innovation management and technology entrepreneurship. I study startup ecosystems in Indian tier-2 cities, develop frameworks for university-industry collaboration in technology transfer, and investigate digital transformation strategies for SMEs.',
    researchAreas: ['Innovation Management', 'Technology Entrepreneurship', 'Digital Transformation'],
    keywords: ['startup ecosystem', 'technology transfer', 'innovation', 'SME digitalization', 'university-industry', 'entrepreneurship'],
    publications: [
      { title: 'Startup Ecosystem Development in Indian Tier-2 Cities: A Multi-stakeholder Framework', year: 2024, venue: 'Technovation' },
    ]
  },
  {
    firstName: 'Jyoti', lastName: 'Bala',
    department: 'Economics', school: 'School of Business',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'I research development economics and public policy. My work analyzes the impact of government welfare programs on rural poverty reduction, studies financial inclusion through digital payment systems, and investigates gender disparities in labor market outcomes in India.',
    researchAreas: ['Development Economics', 'Public Policy', 'Financial Inclusion'],
    keywords: ['poverty reduction', 'welfare programs', 'digital payments', 'financial inclusion', 'gender economics', 'rural development'],
    publications: [
      { title: 'Impact of Jan Dhan-Aadhaar-Mobile (JAM) Trinity on Financial Inclusion in Rural India', year: 2024, venue: 'World Development' },
    ]
  },

  // School of Law (1 researcher)
  {
    firstName: 'Harsh', lastName: 'Wardhan',
    department: 'Law', school: 'School of Law',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'My research focuses on intellectual property law and technology regulation. I study patent law reform in India, analyze AI governance frameworks, data protection legislation, and work on harmonizing IP laws for cross-border technology collaboration.',
    researchAreas: ['Intellectual Property Law', 'Technology Regulation', 'AI Governance'],
    keywords: ['patent law', 'IP rights', 'AI regulation', 'data protection', 'technology law', 'DPDP Act'],
    publications: [
      { title: 'AI Governance Framework for India: Balancing Innovation and Regulation', year: 2024, venue: 'Computer Law & Security Review' },
    ]
  },

  // School of Education (1 researcher)
  {
    firstName: 'Seema', lastName: 'Bajaj',
    department: 'Education', school: 'School of Education',
    careerStage: 'ASSOCIATE_PROFESSOR',
    researchSummary: 'My research focuses on educational technology and pedagogy. I study the effectiveness of blended learning in higher education, develop STEM teaching methodologies for rural schools, and investigate the impact of NEP 2020 on curriculum design in Indian universities.',
    researchAreas: ['Educational Technology', 'STEM Education', 'Curriculum Design'],
    keywords: ['blended learning', 'edtech', 'STEM', 'NEP 2020', 'pedagogy', 'rural education'],
    publications: [
      { title: 'Impact of Blended Learning on Student Outcomes in Indian Engineering Education Post-NEP 2020', year: 2025, venue: 'Studies in Higher Education' },
    ]
  },
]

// ------------------------------------------------------------------
// Helper functions
// ------------------------------------------------------------------

async function hashPasswordAsync(password) {
  return bcrypt.hash(password, 12)
}

function buildNormalizedText(r) {
  return [
    r.researchSummary ? `research summary: ${r.researchSummary}` : '',
    r.researchAreas.length ? `research areas: ${r.researchAreas.join(', ')}` : '',
    r.keywords.length ? `keywords: ${r.keywords.join(', ')}` : '',
    r.department ? `department: ${r.department}` : '',
    `institution: Lovely Professional University`,
    `institution type: UNIVERSITY`,
    r.careerStage ? `career stage: ${r.careerStage}` : '',
    `country of residence: India`,
    `application languages: English, Hindi`,
  ].filter(Boolean).join(' | ')
}

function buildContentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function buildPublicationMatchText(pub) {
  return [pub.title, pub.venue || ''].filter(Boolean).join(' | ')
}

// ------------------------------------------------------------------
// Main seeding
// ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const tenantIdArg = args.find(a => a.startsWith('--tenant-id='))
  let tenantId = tenantIdArg ? tenantIdArg.split('=')[1] : null

  if (!tenantId) {
    const tenant = await prisma.tenant.findFirst({
      where: { atiId: { not: 'PLATFORM' }, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' }
    })
    if (!tenant) {
      console.error('No active non-platform tenant found. Create one first.')
      process.exit(1)
    }
    tenantId = tenant.id
    console.log(`Auto-selected tenant: ${tenant.name} (${tenant.atiId}) — ${tenantId}`)
  }

  // Ensure tenant has ENTERPRISE_PLAN entitlement
  const enterprisePlan = await prisma.plan.findUnique({ where: { code: 'ENTERPRISE_PLAN' } })
  if (!enterprisePlan) {
    console.error('ENTERPRISE_PLAN not found. Run seed-production-plans.js first.')
    process.exit(1)
  }

  const existingTenantPlan = await prisma.tenantPlan.findFirst({
    where: { tenantId, plan: { code: 'ENTERPRISE_PLAN' } }
  })
  if (!existingTenantPlan) {
    await prisma.tenantPlan.create({
      data: {
        tenantId,
        planId: enterprisePlan.id,
        source: 'MANUAL',
        sourceRef: `demo-seed-${tenantId}`,
        status: 'ACTIVE',
        effectiveFrom: new Date(),
        metadata: { reason: 'demo_seed_enterprise_access' },
      }
    })
    console.log('✓ ENTERPRISE_PLAN assigned to tenant')
  } else {
    console.log('✓ Tenant already has ENTERPRISE_PLAN')
  }

  const passwordHash = await hashPasswordAsync(DEFAULT_PASSWORD)
  let created = 0, skipped = 0

  console.log(`\nSeeding ${LPU_RESEARCHERS.length} demo researchers into tenant ${tenantId}...\n`)

  for (const r of LPU_RESEARCHERS) {
    const email = `${r.firstName.toLowerCase()}.${r.lastName.toLowerCase()}@lpu.in`
    const existingUser = await prisma.user.findUnique({ where: { email } })

    if (existingUser) {
      console.log(`  ⏭  ${email} — already exists, skipping`)
      skipped++
      continue
    }

    await prisma.$transaction(async (tx) => {
      // 1. Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          tenantId,
          firstName: r.firstName,
          lastName: r.lastName,
          name: `${r.firstName} ${r.lastName}`,
          roles: ['ANALYST'],
          status: 'ACTIVE',
          emailVerified: true,
        }
      })

      // 2. Create default project
      await tx.project.create({
        data: {
          name: 'Default Project',
          userId: user.id,
          tenantId,
        }
      })

      // 3. Create researcher profile
      const normalizedText = buildNormalizedText(r)
      const contentHash = buildContentHash(normalizedText)

      await tx.$executeRaw`
        INSERT INTO researcher_profiles (
          id, user_id, display_name, country_of_residence, citizenship_countries,
          institution_name, institution_type, department, career_stage,
          years_of_experience, application_languages,
          research_summary, research_areas, keywords,
          normalized_text, content_hash,
          created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${user.id}, ${`Dr. ${r.firstName} ${r.lastName}`}, ${'India'},
          ${['India']}::text[], ${'Lovely Professional University'}, ${'UNIVERSITY'},
          ${r.department}, ${r.careerStage}, ${10},
          ${['English', 'Hindi']}::text[],
          ${r.researchSummary}, ${r.researchAreas}::text[], ${r.keywords}::text[],
          ${normalizedText}, ${contentHash},
          NOW(), NOW()
        )
        ON CONFLICT (user_id) DO NOTHING
      `

      // 4. Create saved research areas (one per research area)
      for (const area of r.researchAreas) {
        const areaText = [
          area,
          `research area: ${area}`,
          r.keywords.length ? `keywords: ${r.keywords.join(', ')}` : '',
        ].filter(Boolean).join(' | ')
        const areaHash = buildContentHash(areaText)

        await tx.$executeRaw`
          INSERT INTO researcher_saved_research_areas (
            id, user_id, label, research_area, keywords, disciplines,
            is_default, use_for_alerts,
            normalized_text, content_hash,
            created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${user.id}, ${area}, ${area},
            ${r.keywords}::text[], ${r.researchAreas}::text[],
            ${r.researchAreas.indexOf(area) === 0}, ${true},
            ${areaText}, ${areaHash},
            NOW(), NOW()
          )
        `
      }

      // 5. Create funding publications (reference_library entries)
      for (const pub of (r.publications || [])) {
        const matchText = buildPublicationMatchText(pub)
        const matchHash = buildContentHash(matchText)

        await tx.citation.create({
          data: {
            userId: user.id,
            tenantId,
            title: pub.title,
            year: pub.year,
            venue: pub.venue || null,
            citationType: 'JOURNAL',
            sourceType: 'JOURNAL_ARTICLE',
            tags: ['my-publication'],
            fundingMatchText: matchText,
            fundingMatchHash: matchHash,
          }
        })
      }

      console.log(`  ✓  ${email} — ${r.department} (${r.researchAreas.join(', ')})`)
      created++
    })
  }

  console.log(`\n✅ Done: ${created} created, ${skipped} skipped.`)
  console.log('   Password for all demo users: Password*77')
  console.log('\n📎 Next: run the embedding backfill to generate vectors:')
  console.log('   POST /api/admin/funding/embeddings/backfill {"target":"all","limit":100}')
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
