import React from 'react';
import {createRoot} from 'react-dom/client';
import OrganizationWorkspace from '../src/components/organization/OrganizationWorkspace.jsx';
createRoot(document.getElementById('root')).render(<><p style={{textAlign:'center'}}>Local test preview — synthetic people only</p><OrganizationWorkspace/></>);
