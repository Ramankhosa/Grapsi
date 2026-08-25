# Phase 2 — map all 1,857 labels onto the approved vocabulary

The Phase 1 vocabulary has been reviewed and APPROVED: 239 labels, no bare
faculty-level buckets, projected ~10.8 researchers per label.

Attach `lpu-area-vocabulary.xlsx` again and give Claude the prompt below.
The approved vocabulary is written into the prompt itself, so it cannot drift
between batches.

---

## PROMPT — copy from here

You are standardising the research-area vocabulary for a university's
Directorate of Sponsored Research.

The attached workbook's "Labels" sheet has 1,857 rows. Each row is a research
area label currently attached to at least one researcher, with how many
researchers use it and a sample of their keywords. The `Canonical Label` column
is empty.

The canonical vocabulary below is FROZEN and already approved. Map every row onto
exactly one entry from it.

### Rules

1. The canonical label you return must be copied CHARACTER-FOR-CHARACTER from the
   list below, including its spelling. Never invent, reword, abbreviate, pluralise
   or merge entries. Do not add new entries.
2. If nothing fits well, choose the CLOSEST available entry. A slightly loose
   match is far better than a new label — the whole point is that researchers end
   up sharing labels. Never leave a row blank.
3. Map by what is actually studied, not by wording. "Deep Learning for Medical
   Imaging" belongs with medical image analysis, not with general deep learning.
   "Fruit Crop Production and Orcharding" is horticulture.
4. Never map a label onto something NARROWER than itself. You are merging upward.
5. Fill ONLY the `Canonical Label` column. `Current Label`, `Used By` and the
   keywords column must come back exactly as supplied — `Current Label` is the
   join key.
6. Return ALL 1,857 rows, in the original order. Do not drop, merge, reorder or
   deduplicate rows. Many rows sharing one canonical label is the intended
   outcome — they still stay as separate rows.

### Working in batches

Process the rows in order, in batches, and keep going until all 1,857 are done.
Do not stop early or summarise. Never introduce a canonical label that is not in
the list below, no matter which batch you are on.

### Examples

| Current Label | Canonical Label |
|---|---|
| 5G Communication | Wireless Communication Systems |
| 6G Wireless Communication | Wireless Communication Systems |
| Plant Breeding | Plant Breeding and Genetics |
| Consumer Behavior | Consumer Behaviour |
| Cloud Computing | Cloud Computing and Virtualization |
| Plant Pathology | Plant Pathology |

That last row matters: a label that already appears verbatim in the vocabulary
maps to itself.

### THE APPROVED VOCABULARY — 239 entries, use these and only these

1. Agronomy
2. Crop Nutrient Management
3. Soil Fertility and Soil Health
4. Irrigation and Water Management
5. Weed Science
6. Cropping Systems and Conservation Agriculture
7. Organic Farming
8. Sustainable Agriculture
9. Precision Agriculture and Digital Farming
10. AI for Plant Disease Detection
11. Plant Breeding and Genetics
12. Cereal Crop Improvement
13. Legume and Oilseed Crop Improvement
14. Vegetable Breeding and Genetics
15. Seed Science and Technology
16. Plant Abiotic Stress Physiology
17. Crop Physiology
18. Plant Growth Regulation and Biostimulants
19. Plant Molecular Biology
20. Plant Tissue Culture and Micropropagation
21. Plant Pathology
22. Biological Control and Integrated Disease Management
23. Agricultural Entomology
24. Integrated Pest Management
25. Botanical Pesticides and Biopesticides
26. Apiculture and Pollinator Science
27. Horticulture and Fruit Science
28. Vegetable Production Science
29. Floriculture and Ornamental Horticulture
30. Horticultural Crop Management
31. Post-Harvest Technology
32. Food Packaging and Edible Coatings
33. Food Processing and Preservation
34. Food Process Engineering
35. Food Science and Technology
36. Functional Foods and Nutraceuticals
37. Food Chemistry and Analysis
38. Food Microbiology and Safety
39. Agro-Waste Valorisation
40. Fermentation and Food Biotechnology
41. Gut Microbiome and Probiotics
42. Livestock Production and Animal Husbandry
43. Agricultural Economics
44. Agricultural Extension and Rural Development
45. Agricultural Marketing and Farm Economics
46. Dairy and Livestock Economics
47. Agroforestry and Forest Science
48. Farm Machinery and Agricultural Engineering
49. Agrometeorology and Crop Modelling
50. Environmental Bioremediation and Phytoremediation
51. Wastewater Treatment Technology
52. Water Quality and Groundwater Contamination
53. Air Quality and Environmental Monitoring
54. Environmental Toxicology
55. Microplastic Pollution Research
56. Solid Waste Management and Waste-to-Energy
57. Adsorption and Water Remediation Materials
58. Climate Science and Climate Data Analysis
59. Remote Sensing and GIS
60. Natural Hazard and Landslide Risk Mapping
61. Hydrology and Water Resources
62. Ecology and Biodiversity
63. Environmental Microbiology
64. Microbial Biotechnology
65. Microbial Genomics and Molecular Evolution
66. Antimicrobial Resistance and Clinical Microbiology
67. Enzyme and Industrial Biotechnology
68. Biofuels and Bioenergy
69. Plant-Microbe Interactions and Soil Microbiology
70. Mycology and Fungal Biotechnology
71. Bioinformatics and Computational Biology
72. Vaccine Development and Immunology
73. Molecular Genetics and Genomics
74. Reproductive and Livestock Biotechnology
75. Cancer Biology and Molecular Oncology
76. Cancer Nanomedicine and Immunotherapy
77. Neurodegenerative Disease Research
78. Endocrinology and Reproductive Health
79. Medicinal Chemistry
80. Computational Drug Discovery and Molecular Modelling
81. Anticancer Drug Discovery
82. Antidiabetic and Metabolic Drug Discovery
83. Antimicrobial and Antiviral Drug Discovery
84. Synthetic Organic Chemistry
85. Coordination and Bioinorganic Chemistry
86. Phytochemistry and Natural Product Chemistry
87. Ethnopharmacology and Medicinal Plant Research
88. Herbal Medicine and Traditional Formulations
89. Neuropharmacology
90. Pharmacology and Pharmacotherapeutics
91. Pharmacoepidemiology and Evidence Synthesis
92. Nanomedicine and Targeted Drug Delivery
93. Pharmaceutical Formulation Development
94. Transdermal and Dermal Drug Delivery
95. Pharmaceutical Analysis and Method Development
96. Pharmacognosy
97. Pharmaceutical Regulation and Management
98. Wound Healing and Tissue Repair
99. Physical Chemistry of Solutions and Surfactants
100. Computational Materials Science and DFT
101. Corrosion Science and Inhibition
102. Catalysis and Green Synthesis
103. Photocatalysis
104. Fluorescent Chemosensors and Molecular Probes
105. Biopolymers and Sustainable Materials
106. Green Nanoparticle Synthesis
107. Ferrite and Magnetic Nanomaterials
108. Supercapacitor Electrode Materials
109. Battery and Energy Storage Materials
110. Thin Film Materials and Coatings
111. Luminescent and Phosphor Materials
112. Perovskite and Functional Oxide Materials
113. Microwave Absorption and EMI Shielding Materials
114. Conducting Polymer Nanocomposites
115. Polymer and Natural Fiber Composites
116. Metal Matrix Composites and Alloys
117. Biomaterials and Tissue Engineering
118. Nanomaterials Synthesis and Characterization
119. Functional Ceramics and Gas Sensors
120. Tunnel FET and Nanoscale Semiconductor Devices
121. VLSI and Low-Power Circuit Design
122. MEMS and Semiconductor Fabrication
123. Biosensors and Electrochemical Sensing
124. Spintronics and Magnetic Devices
125. Laser-Plasma Interaction and Particle Acceleration
126. Nonlinear Optics
127. Nuclear Structure Physics
128. Cosmology and Gravitation
129. Radiation Physics and Dosimetry
130. Numerical Methods for Differential Equations
131. Fractional Calculus and Applications
132. Computational Fluid Dynamics and Heat Transfer
133. Elasticity and Wave Propagation Mechanics
134. Functional Analysis and Fixed Point Theory
135. Complex Analysis and Polynomial Inequalities
136. Differential Geometry
137. Harmonic Analysis and Integral Transforms
138. Number Theory and Discrete Mathematics
139. Mathematical Ecology and Epidemiology
140. Operations Research and Supply Chain Optimization
141. Fuzzy Systems and Decision-Making
142. Optimization Theory and Algorithms
143. Applied Statistics and Statistical Modelling
144. Nonlinear Dynamics and Chaos
145. Deep Learning
146. Machine Learning
147. Computer Vision
148. Medical Image Analysis
149. AI for Medical Diagnostics
150. Natural Language Processing
151. Metaheuristic and Bio-Inspired Optimization
152. Internet of Things
153. Smart Cities and Intelligent Transportation
154. Cloud Computing and Virtualization
155. Edge and Fog Computing
156. Distributed Systems
157. Network Security and Intrusion Detection
158. Cybersecurity and Malware Analysis
159. Cryptography and Information Security
160. Blockchain and Distributed Ledger Technology
161. IoT Security
162. Digital Forensics
163. Biometric Recognition and Authentication
164. Wireless Communication Systems
165. Antenna Design and Microwave Engineering
166. Wireless Sensor Networks
167. Wireless Network Routing Protocols
168. UAV Systems and Networks
169. Optical Communication Systems
170. Software Engineering and Fault Prediction
171. Recommender Systems and Educational Data Mining
172. Data Mining and Soft Computing
173. Social Network and Media Analytics
174. Explainable AI and Federated Learning
175. Robotics and Autonomous Systems
176. Health Informatics and Smart Healthcare
177. Power Systems and Smart Grid
178. Solar and Renewable Energy Systems
179. Additive Manufacturing
180. Machining and Manufacturing Processes
181. Welding and Materials Joining
182. Thermal Spray and Surface Coatings
183. Tribology and Wear Analysis
184. Thermal Engineering and Heat Transfer
185. Internal Combustion Engines and Alternative Fuels
186. Aerospace Propulsion and Aerodynamics
187. Machine Design and Finite Element Analysis
188. Reliability Engineering and Stochastic Modelling
189. Concrete and Sustainable Construction Materials
190. Structural Engineering
191. Geotechnical Engineering
192. Transportation and Pavement Engineering
193. Building Energy Efficiency and Green Buildings
194. Consumer Behaviour
195. Digital and Social Media Marketing
196. Sustainable Consumption and Green Marketing
197. Services and Retail Marketing
198. Tourism and Hospitality Management
199. Sustainable Tourism Development
200. Behavioural Finance and Financial Markets
201. Corporate Finance and Governance
202. Financial Technology and Digital Finance
203. Sustainable and Green Finance
204. Human Resource Management
205. Organizational Behaviour and Workplace Psychology
206. Entrepreneurship and SME Management
207. Supply Chain Management
208. Lean Six Sigma and Quality Management
209. Industry 4.0 and Digital Transformation
210. Circular Economy and Sustainable Operations
211. Accounting and Financial Reporting
212. Development Economics and Trade
213. Health Economics and Policy
214. Clinical and Counselling Psychology
215. Educational Psychology and Student Well-Being
216. Mental Health and Well-Being
217. Educational Technology and E-Learning
218. Higher Education and Pedagogy
219. Inclusive Education and Education Policy
220. STEM and Mathematics Education
221. Postcolonial and Diaspora Literature
222. Literary Criticism and Cultural Studies
223. Applied Linguistics and Sociolinguistics
224. Gender and Women's Studies
225. Sociology and Social Anthropology
226. Media and Communication Studies
227. Fashion and Popular Culture Studies
228. Cultural History and Heritage Studies
229. Law and Intellectual Property Rights
230. Political Science and Security Studies
231. Public Policy and Governance
232. Library Science and Bibliometrics
233. Physiotherapy and Rehabilitation
234. Sports Science and Exercise Physiology
235. Public Health and Epidemiology
236. Forensic Science
237. Textile Science and Technology
238. Chemical Process Engineering and Separations
239. Urban Planning and Landscape Studies

Return the completed workbook with all 1,857 rows.

## PROMPT — copy to here

---

## When it comes back

Send me the file (CSV or XLSX). I validate before applying anything:

- all 1,857 rows present, `Current Label` unchanged
- every canonical value is one of the approved 239 — anything else is rejected
  rather than silently accepted
- the real spread, researchers per label, to confirm we landed near 5-15

Then I apply it to all 855 researchers at no cost, move each researcher's
original specific labels into `Keywords` so precision is preserved, regenerate
the roster, and re-run the pre-flight and the existing-tenant rehearsal.
